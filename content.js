// Immediate logging to verify script is running
console.log('Content script starting...');

// Function to initialize the content script
function initializeContentScript() {
    console.log('Initializing content script...');
    
    // Log the current URL and document state
    console.log('Current URL:', window.location.href);
    console.log('Document ready state:', document.readyState);
    console.log('Document body exists:', !!document.body);
    
    // Check if we're on X (Twitter)
    if (!window.location.hostname.includes('x.com') && !window.location.hostname.includes('twitter.com')) {
        console.log('Not on X/Twitter, skipping initialization');
        return;
    }
    
    console.log('Page check passed, proceeding with initialization');
    
    // Wait a short moment to ensure the page is fully loaded
    setTimeout(() => {
        console.log('Setting up post observer...');
        setupPostObserver();
        console.log('Content script initialization complete');
    }, 1000);
}

// Function to send message to background script
function sendMessageToBackground(message) {
    console.log('Sending message to background:', {
        action: message.action,
        hasContent: !!message.content,
        hasText: !!message.content?.text,
        mediaCount: message.content?.media?.length || 0,
        platforms: message.platforms
    });
    
    chrome.runtime.sendMessage(message, response => {
        console.log('Received response from background:', response);
        if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError);
        }
    });
}

// Function to find compose area
function findComposeArea() {
    console.log('Looking for compose area...');
    const selectors = [
        '[data-testid="tweetTextarea_0"]',
        '[data-testid="postTextarea_0"]',
        '[data-testid="tweetBox"]',
        '[data-testid="postBox"]',
        '[data-testid="tweetTextarea"]',
        '[data-testid="postTextarea"]',
        '[data-testid="tweetBox"] textarea',
        '[data-testid="postBox"] textarea',
        '.public-DraftEditor-content',
        '[data-testid="tweetTextarea_0RichTextInputContainer"]',
        '[data-testid="tweetTextarea_0_label"]',
        '[data-testid="toolBar"]',
        '[data-testid="fileInput"]',
        '[data-testid="gifSearchButton"]',
        '[data-testid="createPollButton"]',
        '[data-testid="scheduleOption"]',
        '[data-testid="geoButton"]'
    ];
    
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            console.log('Found compose area with selector:', selector);
            return element;
        }
    }
    
    console.log('No compose area found with any selector');
    return null;
}

// Function to get image data from element
async function getImageData(img) {
    return new Promise((resolve, reject) => {
        // Create a canvas to get the image data
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        // Draw the image to the canvas
        ctx.drawImage(img, 0, 0);
        
        // Convert canvas to blob
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Failed to create blob from canvas'));
                return;
            }
            
            // Convert blob to base64
            const reader = new FileReader();
            reader.onloadend = () => {
                resolve({
                    blob: reader.result,
                    type: blob.type
                });
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.95);
    });
}

// Function to get post content
async function getPostContent() {
    console.log('Getting post content...');
    
    // Get the compose area
    const composeArea = findComposeArea();
    if (!composeArea) {
        console.error('Compose area not found');
        return null;
    }
    
    // Get the text content
    let text = '';
    const textArea = document.querySelector('[data-testid="tweetTextarea_0"]') || 
                    document.querySelector('[data-testid="postTextarea_0"]') ||
                    document.querySelector('[data-testid="tweetTextarea_0RichTextInputContainer"]');
    
    if (textArea) {
        if (textArea.classList.contains('public-DraftEditor-content')) {
            // Handle Draft.js editor
            const textBlocks = textArea.querySelectorAll('[data-text="true"]');
            text = Array.from(textBlocks).map(block => block.textContent).join('\n');
        } else if (textArea.tagName === 'TEXTAREA') {
            text = textArea.value;
        } else {
            text = textArea.textContent;
        }
    }
    
    // If there's no text content, return null
    if (!text.trim()) {
        console.log('No text content found');
        return null;
    }
    
    console.log('Found text content:', text);
    
    // Create a Set to track unique media items
    const processedMedia = new Set();
    const media = [];
    
    // Get media attachments
    const mediaContainer = document.querySelector('[data-testid="attachments"]') ||
                          document.querySelector('[data-testid="toolBar"]');
    
    if (mediaContainer) {
        console.log('Found media container');
        // Look for images in the media container
        const images = mediaContainer.querySelectorAll('img');
        console.log('Found images:', images.length);
        
        // Process each image
        for (const img of images) {
            console.log('Processing image:', {
                src: img.src,
                alt: img.alt,
                isBlob: img.src.startsWith('blob:')
            });
            
            if (img.src && !img.src.startsWith('data:')) {
                try {
                    // Create a unique key for this media item
                    const mediaKey = img.src;
                    
                    // Skip if we've already processed this media
                    if (processedMedia.has(mediaKey)) {
                        console.log('Skipping duplicate media item');
                        continue;
                    }
                    
                    processedMedia.add(mediaKey);
                    const imageData = await getImageData(img);
                    media.push({
                        type: 'image',
                        url: img.src,
                        alt: img.alt || '',
                        data: imageData.blob
                    });
                    console.log('Added image data to media array');
                } catch (error) {
                    console.error('Error processing image:', error);
                }
            }
        }
        
        // Also look for background images
        const divsWithBg = mediaContainer.querySelectorAll('div[style*="background-image"]');
        console.log('Found divs with background images:', divsWithBg.length);
        
        for (const div of divsWithBg) {
            const style = div.getAttribute('style');
            const match = style.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1] && !match[1].startsWith('data:')) {
                console.log('Found background image:', match[1]);
                
                // Skip if we've already processed this media
                if (processedMedia.has(match[1])) {
                    console.log('Skipping duplicate background image');
                    continue;
                }
                
                processedMedia.add(match[1]);
                try {
                    const response = await fetch(match[1]);
                    const blob = await response.blob();
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        media.push({
                            type: 'image',
                            url: match[1],
                            alt: '',
                            data: reader.result
                        });
                        console.log('Added background image data to media array');
                    };
                    reader.readAsDataURL(blob);
                } catch (error) {
                    console.error('Error processing background image:', error);
                }
            }
        }
    } else {
        console.log('No media container found, searching entire compose area');
        // Fallback: search the entire compose area for images
        const allImages = composeArea.parentElement.querySelectorAll('img');
        console.log('Found images in compose area:', allImages.length);
        
        for (const img of allImages) {
            if (img.src && !img.src.startsWith('data:')) {
                console.log('Found image in compose area:', {
                    src: img.src,
                    alt: img.alt
                });
                
                // Skip if we've already processed this media
                if (processedMedia.has(img.src)) {
                    console.log('Skipping duplicate image from compose area');
                    continue;
                }
                
                processedMedia.add(img.src);
                try {
                    const imageData = await getImageData(img);
                    media.push({
                        type: 'image',
                        url: img.src,
                        alt: img.alt || '',
                        data: imageData.blob
                    });
                    console.log('Added image data to media array');
                } catch (error) {
                    console.error('Error processing image:', error);
                }
            }
        }
    }
    
    console.log('Final media array:', media);
    
    return {
        text: text.trim(),
        media
    };
}

// Function to find the post button
function findPostButton() {
    console.log('Looking for post button...');
    
    // Check if we're on the compose/post page
    const isComposePage = window.location.pathname.includes('/compose/post');
    
    // For compose/post page, use the exact button structure
    if (isComposePage) {
        const button = document.querySelector('button[data-testid="tweetButtonInline"][role="button"]');
        if (button) {
            console.log('Found post button on compose page:', {
                dataTestId: button.getAttribute('data-testid'),
                role: button.getAttribute('role'),
                type: button.getAttribute('type'),
                isDisabled: button.hasAttribute('disabled')
            });
            return button;
        }
    }
    
    // For home page, try all selectors
    const selectors = [
        '[data-testid="tweetButtonInline"]',
        '[data-testid="postButtonInline"]',
        '[data-testid="tweetButton"]',
        '[data-testid="postButton"]',
        'button[role="button"]:has(span:contains("Post"))',
        'button[role="button"]:has(span:contains("Tweet"))'
    ];
    
    for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button) {
            console.log('Found post button with selector:', selector);
            return button;
        }
    }
    
    // Last resort: try to find any button containing "Post" or "Tweet" text
    const allButtons = document.querySelectorAll('button');
    for (const button of allButtons) {
        const buttonText = button.textContent.toLowerCase();
        if (buttonText.includes('post') || buttonText.includes('tweet')) {
            console.log('Found post button by text content');
            return button;
        }
    }
    
    console.log('No post button found with any selector');
    return null;
}

// Function to setup post observer
function setupPostObserver() {
    console.log('Setting up post observer...');
    
    // Store content when post button is clicked
    let storedContent = null;
    let isPosting = false; // Flag to prevent multiple posts
    let lastPostTime = 0; // Track last post time for debouncing
    let lastButtonState = false; // Track the last disabled state of the button
    
    // Function to reset flags
    function resetFlags() {
        isPosting = false;
        lastPostTime = 0;
        lastButtonState = false;
        console.log('Reset all posting flags');
    }
    
    // Function to process the post
    async function processPost() {
        if (isPosting) {
            console.log('Post already in progress, skipping');
            return;
        }
        
        isPosting = true;
        console.log('Processing post...');
        
        try {
            let contentToPost = storedContent;
            
            // If no stored content, try to get it now
            if (!contentToPost) {
                console.log('No stored content found, recapturing...');
                contentToPost = await getPostContent();
            }
            
            if (contentToPost && contentToPost.text.trim()) {
                console.log('Found content to post:', {
                    hasText: !!contentToPost.text,
                    textLength: contentToPost.text.length,
                    mediaCount: contentToPost.media.length
                });
                
                // Get Mastodon settings
                chrome.storage.sync.get(['mastodonEnabled'], (settings) => {
                    console.log('Mastodon settings:', settings);
                    if (settings.mastodonEnabled) {
                        const platforms = {
                            mastodon: true
                        };
                        console.log('Sending cross-post request with platforms:', platforms);
                        sendMessageToBackground({
                            action: "crosspost",
                            content: contentToPost,
                            platforms: platforms
                        });
                    } else {
                        console.log('Mastodon cross-posting is disabled');
                    }
                });
            } else {
                console.log('No valid content to post');
            }
        } finally {
            // Reset flags after a delay
            setTimeout(resetFlags, 5000); // Wait 5 seconds before allowing another post
        }
    }
    
    // Function to setup button handlers
    function setupButtonHandlers(button) {
        console.log('Setting up handlers for button:', {
            dataTestId: button.getAttribute('data-testid'),
            role: button.getAttribute('role'),
            type: button.getAttribute('type'),
            isDisabled: button.hasAttribute('disabled')
        });
        
        // Add click handler to capture content
        button.addEventListener('click', async () => {
            console.log('Post button clicked');
            if (!isPosting) {
                storedContent = await getPostContent();
                console.log('Stored content:', storedContent);
            }
        });
        
        // Observe the post button for changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
                    const isDisabled = button.hasAttribute('disabled');
                    const currentTime = Date.now();
                    
                    console.log('Post button state changed:', {
                        isDisabled,
                        isPosting,
                        lastButtonState,
                        timeSinceLastPost: currentTime - lastPostTime,
                        buttonClasses: button.className
                    });
                    
                    // Only process if the button just became disabled (transition from enabled to disabled)
                    if (isDisabled && !lastButtonState && !isPosting) {
                        // Only proceed if at least 2 seconds have passed since last post
                        if (currentTime - lastPostTime > 2000) {
                            console.log('Post is being sent, waiting 1 second...');
                            lastPostTime = currentTime;
                            
                            // Wait a short moment before processing the post
                            setTimeout(processPost, 1000);
                        } else {
                            console.log('Ignoring duplicate post event - within debounce period');
                        }
                    }
                    // Update the last button state
                    lastButtonState = isDisabled;
                }
            });
        });
        
        // Start observing the button
        observer.observe(button, {
            attributes: true,
            attributeFilter: ['disabled']
        });
        
        // Log initial button state
        console.log('Initial button state:', {
            isDisabled: button.hasAttribute('disabled'),
            isPosting,
            lastButtonState,
            timeSinceLastPost: Date.now() - lastPostTime,
            buttonClasses: button.className
        });
        
        console.log('Button handlers setup complete');
    }
    
    // Try to find the button immediately
    const button = findPostButton();
    if (button) {
        console.log('Found post button immediately');
        setupButtonHandlers(button);
    } else {
        // If button not found, observe the document for changes
        console.log('Post button not found, observing document for changes...');
        const observer = new MutationObserver((mutations) => {
            const button = findPostButton();
            if (button) {
                console.log('Button found after DOM changes');
                observer.disconnect();
                setupButtonHandlers(button);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    console.log('Post observer setup complete');
}

// Initialize immediately
console.log('Attempting immediate initialization');
initializeContentScript();

// Also initialize on DOMContentLoaded if not already initialized
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired, checking initialization');
    if (!document.querySelector('[data-testid="tweetButtonInline"]')) {
        console.log('No button found, retrying initialization');
        initializeContentScript();
    }
});

// Backup initialization on load
window.addEventListener('load', () => {
    console.log('Window load fired, checking initialization');
    if (!document.querySelector('[data-testid="tweetButtonInline"]')) {
        console.log('No button found, retrying initialization');
        initializeContentScript();
    }
});

// Add message listener for blob data requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getBlobData') {
        console.log('Received request for blob data:', message.blobUrl);
        
        // Find the image element with this blob URL
        const img = document.querySelector(`img[src="${message.blobUrl}"]`);
        if (!img) {
            console.error('Image element not found for blob URL:', message.blobUrl);
            sendResponse({ error: 'Image element not found' });
            return true;
        }
        
        // Create a canvas to get the image data
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        // Draw the image to the canvas
        ctx.drawImage(img, 0, 0);
        
        // Convert canvas to blob
        canvas.toBlob((blob) => {
            if (!blob) {
                console.error('Failed to create blob from canvas');
                sendResponse({ error: 'Failed to create blob' });
                return;
            }
            
            console.log('Created blob from canvas:', {
                type: blob.type,
                size: blob.size
            });
            
            // Convert blob to base64
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result;
                console.log('Converted blob to base64');
                sendResponse({ 
                    blob: base64data,
                    type: blob.type
                });
            };
            reader.onerror = (error) => {
                console.error('Error reading blob:', error);
                sendResponse({ error: 'Failed to read blob' });
            };
            reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.95);
        
        return true;
    }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getContent') {
        // If we don't have stored content, try to get it now
        if (!storedContent) {
            getPostContent().then(content => {
                storedContent = content;
                sendResponse({ content });
            });
            return true; // Will respond asynchronously
        }
        sendResponse({ content: storedContent });
    }
  });