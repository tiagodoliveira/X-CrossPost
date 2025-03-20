// Inject content script when a tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && (tab.url?.includes('twitter.com') || tab.url?.includes('x.com'))) {
        console.log('Injecting content script into:', tab.url);
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }).then(() => {
            console.log('Content script injected successfully');
        }).catch((error) => {
            console.error('Error injecting content script:', error);
        });
    }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background script received message:', {
        action: message.action,
        hasContent: !!message.content,
        hasText: !!message.content?.text,
        mediaCount: message.content?.media?.length || 0,
        platforms: message.platforms
    });
    
if (message.action === "crosspost") {
        // Handle the crosspost asynchronously
        handleCrossPost(message.content, message.platforms)
            .then(results => {
                console.log('Cross-post results:', results);
                sendResponse({ success: true, results });
            })
            .catch(error => {
                console.error('Error in handleCrossPost:', error);
                sendResponse({ success: false, error: error.message });
            });
        
        // Return true to indicate we'll send a response asynchronously
        return true;
    } else if (message.action === "clearMastodonToken") {
        // Handle token clearing request
        chrome.storage.sync.get(['mastodonToken'], (result) => {
            console.log('Current Mastodon token before clearing:', result.mastodonToken ? 'Present' : 'Missing');
            chrome.storage.sync.remove(['mastodonToken'], () => {
                console.log('Mastodon token cleared successfully');
                sendResponse({ success: true });
            });
        });
        return true;
    }
    
    // For unknown actions, send an error response
    sendResponse({ success: false, error: 'Unknown action' });
    return false;
});

// Handle cross-posting to different platforms
async function handleCrossPost(content, platforms) {
    console.log('Starting cross-post with content:', {
        hasText: !!content?.text,
        textLength: content?.text?.length,
        mediaCount: content?.media?.length || 0,
        platforms: platforms
    });
    
    const settings = await chrome.storage.sync.get([
        'mastodonEnabled',
        'mastodonToken',
        'mastodonInstance'
    ]);
    
    console.log('Retrieved settings:', {
        mastodonEnabled: settings.mastodonEnabled,
        mastodonToken: settings.mastodonToken ? 'Present' : 'Missing',
        mastodonInstance: settings.mastodonInstance
    });

    const results = {
        mastodon: false
    };

    // Post to Mastodon if enabled and authenticated
    if (platforms.mastodon && settings.mastodonEnabled) {
        if (!settings.mastodonToken) {
            console.error('Mastodon token is missing');
            throw new Error('Mastodon authentication required. Please reconnect your Mastodon account.');
        }
        
        try {
            // Check if mastodonInstance is undefined or empty and handle accordingly
            const cleanInstance = settings.mastodonInstance ? settings.mastodonInstance.replace(/^https?:\/\//, '') : 'mastodon.social';
            console.log('Using cleaned Mastodon instance:', cleanInstance);
            
            // Check if we have media to upload
            const hasMedia = content.media && content.media.length > 0;
            
            // Skip token validation and try posting directly
            console.log('Attempting to post to Mastodon');
            await postToMastodon(content, settings.mastodonToken, cleanInstance);
            results.mastodon = true;
            console.log('Successfully posted to Mastodon');
        } catch (error) {
            console.error('Error posting to Mastodon:', error);
            if (error.message.includes('401') || error.message.includes('403')) {
                // Token is invalid or expired
                console.log('Mastodon token appears to be invalid, clearing it');
                await chrome.storage.sync.remove(['mastodonToken']);
                throw new Error('Mastodon authentication expired. Please reconnect your account.');
            }
            throw new Error(`Mastodon error: ${error.message}`);
        }
    }

    // Notify the user about the results
    notifyUser(results);
    
    return results;
}

// Function to validate Mastodon token
async function validateMastodonToken(token, instance) {
    try {
        // Clean the instance URL by removing any protocol prefix
        const cleanInstance = instance.replace(/^https?:\/\//, '');
        console.log('Validating Mastodon token with instance:', cleanInstance);
        
        const response = await fetch(`https://${cleanInstance}/api/v1/accounts/verify_credentials`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('Mastodon token validation failed:', error);
            return false;
        }
        
        const data = await response.json();
        console.log('Mastodon token validation response:', {
            username: data.username,
            scopes: data.scopes,
            source: data.source
        });
        
        // If we get here, the token is valid and has the required permissions
        // The scopes are already verified by Mastodon during the OAuth flow
        return true;
    } catch (error) {
        console.error('Error validating Mastodon token:', error);
        return false;
    }
}

// Function to upload media to Mastodon
async function uploadMediaToMastodon(mediaData, instance, token) {
    try {
        console.log('Starting Mastodon media upload');
        
        // Clean the instance URL by removing any protocol prefix
        const cleanInstance = instance.replace(/^https?:\/\//, '');
        
        // If mediaData is a base64 string, convert it to a blob
        let blob;
        if (typeof mediaData === 'string') {
            if (mediaData.startsWith('data:')) {
                // Convert base64 data URL to blob
                const base64Data = mediaData.split(',')[1];
                const binaryData = atob(base64Data);
                const bytes = new Uint8Array(binaryData.length);
                for (let i = 0; i < binaryData.length; i++) {
                    bytes[i] = binaryData.charCodeAt(i);
                }
                blob = new Blob([bytes], { type: 'image/jpeg' });
                console.log('Converted base64 to blob:', {
                    type: blob.type,
                    size: blob.size
                });
            } else {
                // Handle regular URL
                const response = await fetch(mediaData);
                blob = await response.blob();
            }
        } else {
            blob = mediaData;
        }
        
        // Create FormData and append the blob
        const formData = new FormData();
        formData.append('file', blob, 'image.jpg');
        
        // Upload to Mastodon
        const response = await fetch(`https://${cleanInstance}/api/v2/media`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('Mastodon media upload failed:', {
                status: response.status,
                statusText: response.statusText,
                error: JSON.stringify(error)
            });
            
            // Check if it's a scope error
            if (response.status === 403) {
                throw new Error('Mastodon token missing required scopes. Please reauthorize the app with write:media permission.');
            }
            
            throw new Error(`Mastodon media upload error: ${response.status} - ${JSON.stringify(error)}`);
        }
        
        const data = await response.json();
        console.log('Mastodon media upload successful:', data);
        return data.id;
    } catch (error) {
        console.error('Error in uploadMediaToMastodon:', error);
        throw error;
    }
}

// Post to Mastodon
async function postToMastodon(content, token, instance = 'mastodon.social') {
    // Clean the instance URL by removing any protocol prefix
    const cleanInstance = instance.replace(/^https?:\/\//, '');
    console.log('Posting to Mastodon instance:', cleanInstance);
    console.log('Content:', content);
    
    // Upload media if present
    const mediaIds = [];
    if (content.media && content.media.length > 0) {
        console.log('Found media items:', content.media.length);
        
        // Create a Set to track unique media items
        const processedMedia = new Set();
        
        for (const media of content.media) {
            if (media.type === 'image') {
                try {
                    // Create a unique key for this media item
                    const mediaKey = media.data || media.url;
                    
                    // Skip if we've already processed this media
                    if (processedMedia.has(mediaKey)) {
                        console.log('Skipping duplicate media item');
                        continue;
                    }
                    
                    processedMedia.add(mediaKey);
                    console.log('Processing media item:', media);
                    
                    // If we have image data, use it directly
                    if (media.data) {
                        console.log('Using image data directly');
                        const uploadResult = await uploadMediaToMastodon(media.data, cleanInstance, token);
                        console.log('Upload result:', uploadResult);
                        
                        if (uploadResult) {
                            mediaIds.push(uploadResult);
                            console.log('Added media ID:', uploadResult);
                        }
                    } else if (media.url.startsWith('blob:')) {
                        console.log('Found blob URL, requesting blob data from content script');
                        // Request the blob data from the content script
                        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
                        if (tabs && tabs[0]) {
                            try {
                                const blobData = await chrome.tabs.sendMessage(tabs[0].id, {
                                    action: 'getBlobData',
                                    blobUrl: media.url
                                });
                                
                                if (blobData && blobData.blob) {
                                    console.log('Received blob data from content script');
                                    // Upload to Mastodon
                                    console.log('Uploading image to Mastodon');
                                    const uploadResult = await uploadMediaToMastodon(blobData.blob, cleanInstance, token);
                                    console.log('Upload result:', uploadResult);
                                    
                                    if (uploadResult) {
                                        mediaIds.push(uploadResult);
                                        console.log('Added media ID:', uploadResult);
                                    }
                                } else if (blobData.error) {
                                    console.error('Error from content script:', blobData.error);
                                }
                            } catch (error) {
                                console.error('Error communicating with content script:', error);
                            }
                        }
                    } else {
                        // Handle regular URLs
                        console.log('Fetching image from URL:', media.url);
                        const imageResponse = await fetch(media.url);
                        if (!imageResponse.ok) {
                            throw new Error(`Failed to fetch image: ${imageResponse.status}`);
                        }
                        
                        const imageBlob = await imageResponse.blob();
                        console.log('Image blob created:', {
                            type: imageBlob.type,
                            size: imageBlob.size
                        });
                        
                        // Upload to Mastodon
                        console.log('Uploading image to Mastodon');
                        const uploadResult = await uploadMediaToMastodon(imageBlob, cleanInstance, token);
                        console.log('Upload result:', uploadResult);
                        
                        if (uploadResult) {
                            mediaIds.push(uploadResult);
                            console.log('Added media ID:', uploadResult);
                        }
                    }
                } catch (error) {
                    console.error('Error processing media item:', error);
                    // Continue with other media items even if one fails
                }
            }
        }
    }

    console.log('Creating post with media IDs:', mediaIds);
    // Create the post with media
    const response = await fetch(`https://${cleanInstance}/api/v1/statuses`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            status: content.text,
            visibility: 'public',
            language: 'en',
            media_ids: mediaIds
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Mastodon API error details:', errorText);
        throw new Error(`Mastodon API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Mastodon post successful:', result);
    return result;
}

// Notify the user about cross-posting results
function notifyUser(results) {
    try {
        const message = [];
        if (results.mastodon) message.push('Mastodon');

        if (message.length > 0) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Cross-post Successful',
                message: `Successfully posted to ${message.join(' and ')}`
            }, (notificationId) => {
                if (chrome.runtime.lastError) {
                    console.error('Notification error:', chrome.runtime.lastError);
                }
            });
        } else {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Cross-post Failed',
                message: 'Failed to post to any platform. Please check your authentication settings.'
            }, (notificationId) => {
                if (chrome.runtime.lastError) {
                    console.error('Notification error:', chrome.runtime.lastError);
                }
            });
        }
    } catch (error) {
        console.error('Error creating notification:', error);
    }
}

