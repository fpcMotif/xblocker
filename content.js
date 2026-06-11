// Function to block the first 20 comment tweets on a tweet page
async function blockFirst20CommentTweets() {
	// Check if we're on a tweet page
	const urlPattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
	if (!urlPattern.test(window.location.href)) {
		console.log("Not on a tweet page. Exiting.");
		return;
	}

	// Get all tweet articles on the page
	const tweetArticles = document.querySelectorAll(
		'article[data-testid="tweet"]',
	);

	// Skip the main tweet (the first one)
	const commentTweets = Array.from(tweetArticles).slice(1);

	// Limit to first 20 comments
	const first20Comments = commentTweets.slice(0, 50);

	const progressBar = document.querySelector('.xb-progress-bar');
	const total = first20Comments.length;

	for (let i = 0; i < first20Comments.length; i++) {
		await blockTweet(first20Comments[i]);
		if (progressBar) {
			progressBar.style.width = `${((i + 1) / total) * 100}%`;
		}
	}

	console.log("Finished blocking the first 50 comment tweets.");
}

// Function to get the whitelist from chrome.storage.local
function getWhitelist(callback) {
	chrome.storage.local.get('whitelist', (result) => {
		const whitelist = result.whitelist || [];
		callback(whitelist);
	});
}

// Function to save the whitelist to chrome.storage.local
function saveWhitelist(whitelist) {
	chrome.storage.local.set({ whitelist: whitelist }, () => {
		console.log('Whitelist saved');
	});
}

// Function to add a username to the whitelist
function addToWhitelist(username) {
	getWhitelist((whitelist) => {
		if (!whitelist.includes(username)) {
			whitelist.push(username);
			saveWhitelist(whitelist);
			showToast(`✅ Added @${username} to whitelist`, 'success');
		} else {
			showToast(`⚠️ @${username} is already in the whitelist`, 'warning');
		}
	});
}

// Function to show toast notifications
function showToast(message, type = 'info') {
	const theme = detectTheme();
	const toast = document.createElement('div');
	
	const toastColor = type === 'success' ? theme.colors.success : 
					  type === 'warning' ? theme.colors.warning : 
					  theme.colors.primary;
	
	toast.style.cssText = `
		position: fixed;
		top: 24px;
		right: 24px;
		z-index: 10002;
		background: linear-gradient(135deg, ${toastColor}, ${toastColor}dd);
		color: white;
		padding: 16px 20px;
		border-radius: 12px;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		font-size: 14px;
		font-weight: 500;
		box-shadow: 0 8px 25px rgba(0, 0, 0, ${theme.isDark ? '0.4' : '0.2'});
		border: 1px solid ${theme.colors.border};
		backdrop-filter: blur(12px);
		animation: slideInToast 0.3s ease-out;
		max-width: 300px;
		word-wrap: break-word;
	`;

	// Add toast animation if not already added
	const existingStyle = document.getElementById('xblocker-styles');
	if (existingStyle && !existingStyle.textContent.includes('slideInToast')) {
		existingStyle.textContent += `
			@keyframes slideInToast {
				from { transform: translateX(100%); opacity: 0; }
				to { transform: translateX(0); opacity: 1; }
			}
			@keyframes slideOutToast {
				from { transform: translateX(0); opacity: 1; }
				to { transform: translateX(100%); opacity: 0; }
			}
		`;
	}

	toast.textContent = message;
	document.body.appendChild(toast);

	// Auto-remove after 3 seconds
	setTimeout(() => {
		toast.style.animation = 'slideOutToast 0.3s ease-in forwards';
		setTimeout(() => {
			if (toast.parentNode) {
				toast.remove();
			}
		}, 300);
	}, 3000);

	// Click to dismiss
	toast.addEventListener('click', () => {
		toast.style.animation = 'slideOutToast 0.3s ease-in forwards';
		setTimeout(() => {
			if (toast.parentNode) {
				toast.remove();
			}
		}, 300);
	});
}

// Function to add the block and whitelist buttons to the page
function addButtons() {
	const buttonContainer = document.createElement("div");
	buttonContainer.style.position = "fixed";
	buttonContainer.style.bottom = "20px";
	buttonContainer.style.right = "20px";
	buttonContainer.style.zIndex = "9999";

	// Block Button
	const blockButton = document.createElement("button");
	blockButton.textContent = "Block First 20 Comments";
	blockButton.style.padding = "10px";
	blockButton.style.backgroundColor = "#1DA1F2";
	blockButton.style.color = "white";
	blockButton.style.border = "none";
	blockButton.style.borderRadius = "5px";
	blockButton.style.cursor = "pointer";
	blockButton.style.marginBottom = "10px";

	blockButton.addEventListener("click", blockFirst20CommentTweets);

	// Whitelist Button
	const whitelistButton = document.createElement("button");
	whitelistButton.textContent = "Add to Whitelist";
	whitelistButton.style.padding = "10px";
	whitelistButton.style.backgroundColor = "#1DA1F2";
	whitelistButton.style.color = "white";
	whitelistButton.style.border = "none";
	whitelistButton.style.borderRadius = "5px";
	whitelistButton.style.cursor = "pointer";

	whitelistButton.addEventListener("click", () => {
		const username = prompt("Enter the username to whitelist (without @):");
		if (username) {
			addToWhitelist(username);
		}
	});

	buttonContainer.appendChild(blockButton);
	buttonContainer.appendChild(whitelistButton);
	document.body.appendChild(buttonContainer);
}

// Modify the blockTweet function to skip whitelisted users
async function blockTweet(tweetArticle) {
	// Get the tweet author's username
	const userLink = tweetArticle.querySelector('a[href^="/"][role="link"]');
	let username = null;
	if (userLink) {
		const urlParts = userLink.getAttribute('href').split('/');
		username = urlParts[1];
	}

	return new Promise((resolve) => {
		getWhitelist(async (whitelist) => {
			if (username && whitelist.includes(username)) {
				console.log(`Skipping @${username}, as they are in the whitelist.`);
				resolve();
				return;
			}

			// Find the three dots button
			const moreButton = tweetArticle.querySelector('[aria-label="More"]');

			if (moreButton) {
				// Simulate click on the three dots menu
				moreButton.click();

				// Wait for the menu to appear
				await new Promise((r) => setTimeout(r, 500));

				// Find the "Block @username" menu item
				const menuItems = document.querySelectorAll('[role="menuitem"]');
				let blockItem = null;
				let hideItem = null;
				menuItems.forEach((item) => {
					const itemText = item.innerText.trim();
					if (itemText.startsWith("Block @")) {
						blockItem = item;
					} else if (itemText.startsWith("Hide")) {
						hideItem = item;
					}
				});

				if (blockItem) {
					// Simulate click on "Block @username"
					blockItem.click();

					// Wait for the confirmation modal to appear
					await new Promise((r) => setTimeout(r, 500));

					// Find and click the "Block" button in the modal
					const confirmButton = document.querySelector(
						'[data-testid="confirmationSheetConfirm"]',
					);
					if (confirmButton) {
						confirmButton.click();
					}
				} else if (hideItem) {
					console.log("Block option not found, attempting to hide the tweet.");
					// Simulate click on "Hide"
					hideItem.click();

					// Wait for the confirmation modal to appear
					await new Promise((r) => setTimeout(r, 500));

					// Find and click the "Hide" button in the modal
					const confirmButton = document.querySelector(
						'[data-testid="confirmationSheetConfirm"]',
					);
					if (confirmButton) {
						confirmButton.click();
					}
				} else {
					console.log("Neither Block nor Hide option found.");
				}

				// Wait a bit before proceeding to the next tweet
				await new Promise((r) => setTimeout(r, 500));
			} else {
				console.log("More button not found for a comment tweet.");
			}
			resolve();
		});
	});
}

// Function to mute the first 50 comment tweets on a tweet page
async function muteFirst50CommentTweets() {
	// Check if we're on a tweet page
	const urlPattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
	if (!urlPattern.test(window.location.href)) {
		console.log("Not on a tweet page. Exiting.");
		return;
	}

	// Get all tweet articles on the page
	const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');

	// Skip the main tweet (the first one)
	const commentTweets = Array.from(tweetArticles).slice(1);

	// Limit to first 50 comments
	const first50Comments = commentTweets.slice(0, 50);

	const progressBar = document.querySelector('.xb-progress-bar');
	const total = first50Comments.length;

	for (let i = 0; i < first50Comments.length; i++) {
		await muteTweet(first50Comments[i]);
		if (progressBar) {
			progressBar.style.width = `${((i + 1) / total) * 100}%`;
		}
	}

	console.log("Finished muting the first 50 comment tweets.");
}

// Function to mute a tweet
async function muteTweet(tweetArticle) {
	// Get the tweet author's username
	const userLink = tweetArticle.querySelector('a[href^="/"][role="link"]');
	let username = null;
	if (userLink) {
		const urlParts = userLink.getAttribute('href').split('/');
		username = urlParts[1];
	}

	return new Promise((resolve) => {
		getWhitelist(async (whitelist) => {
			if (username && whitelist.includes(username)) {
				console.log(`Skipping @${username}, as they are in the whitelist.`);
				resolve();
				return;
			}

			// Find the "More" button
			const moreButton = tweetArticle.querySelector('[aria-label="More"]');

			if (moreButton) {
				// Simulate click on the "More" menu
				moreButton.click();

				// Wait for the menu to appear
				await new Promise((r) => setTimeout(r, 500));

				// Find the "Mute @username" menu item
				const menuItems = document.querySelectorAll('[role="menuitem"]');
				let muteItem = null;
				menuItems.forEach((item) => {
					const itemText = item.innerText.trim();
					if (itemText.startsWith("Mute @")) {
						muteItem = item;
					}
				});

				if (muteItem) {
					// Simulate click on "Mute @username"
					muteItem.click();

					// Wait for the confirmation modal to appear
					await new Promise((r) => setTimeout(r, 500));

					// Find and click the "Mute" button in the modal
					const confirmButton = document.querySelector('[data-testid="confirmationSheetConfirm"]');
					if (confirmButton) {
						confirmButton.click();
					}
				} else {
					console.log("Mute option not found.");
				}

				// Wait before proceeding to the next tweet
				await new Promise((r) => setTimeout(r, 500));
			} else {
				console.log("More button not found for a comment tweet.");
			}
			resolve();
		});
	});
}

// Function to detect X.com theme
function detectTheme() {
	// Check for dark mode indicators in X.com
	const html = document.documentElement;
	const body = document.body;
	
	// X.com uses these classes for theme detection
	const isDark = html.style.colorScheme === 'dark' || 
				   body.style.backgroundColor === 'rgb(0, 0, 0)' ||
				   getComputedStyle(body).backgroundColor === 'rgb(0, 0, 0)' ||
				   document.querySelector('[data-theme="dark"]') ||
				   document.querySelector('meta[name="theme-color"][content="#000000"]');
	
	return {
		isDark: !!isDark,
		colors: isDark ? {
			primary: '#1d9bf0', // X.com blue
			success: '#00ba7c', // Green
			warning: '#ffad1f', // Orange  
			danger: '#f4212e',  // Red
			background: 'rgba(0, 0, 0, 0.8)',
			surface: 'rgba(255, 255, 255, 0.03)',
			border: 'rgba(255, 255, 255, 0.08)',
			text: '#e7e9ea',
			textSecondary: '#71767b'
		} : {
			primary: '#1d9bf0', // X.com blue
			success: '#00ba7c', // Green
			warning: '#ffad1f', // Orange
			danger: '#f4212e',  // Red  
			background: 'rgba(255, 255, 255, 0.9)',
			surface: 'rgba(0, 0, 0, 0.03)',
			border: 'rgba(0, 0, 0, 0.08)',
			text: '#0f1419',
			textSecondary: '#536471'
		}
	};
}

// SVG Icon components
function createSVGIcon(type, size = 16, color = 'currentColor') {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', size);
	svg.setAttribute('height', size);
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.style.cssText = `
		display: inline-block;
		vertical-align: middle;
		margin-right: 8px;
		flex-shrink: 0;
	`;

	let path = '';
	switch (type) {
		case 'block':
			path = `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z" fill="${color}"/>`;
			break;
		case 'mute':
			path = `<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.916 8.916 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="${color}"/>`;
			break;
		case 'whitelist':
			path = `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="${color}"/>`;
			break;
		case 'loading':
			svg.innerHTML = `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416">
				<animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
				<animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
			</circle>`;
			return svg;
		case 'success':
			path = `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="${color}"/>`;
			break;
		case 'error':
			path = `<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="${color}"/>`;
			break;
		default:
			path = `<circle cx="12" cy="12" r="10" fill="${color}"/>`;
	}
	
	svg.innerHTML = path;
	return svg;
}

// Global state for dashboard
let dashboardState = {
	isExpanded: false,
	autoCollapseTimer: null,
	isActive: false
};

// Enhanced SVG icon with morphing capability
function createMorphingSVGIcon(type, size = 20, color = 'currentColor') {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', size);
	svg.setAttribute('height', size);
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.style.cssText = `
		display: inline-block;
		vertical-align: middle;
		flex-shrink: 0;
		transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
		transform-origin: center;
	`;

	let path = '';
	switch (type) {
		case 'dashboard':
			path = `<circle cx="12" cy="5" r="3" fill="${color}" opacity="0.8">
				<animate attributeName="r" values="3;4;3" dur="2s" repeatCount="indefinite"/>
			</circle>
			<circle cx="12" cy="12" r="3" fill="${color}">
				<animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/>
			</circle>
			<circle cx="12" cy="19" r="3" fill="${color}" opacity="0.8">
				<animate attributeName="r" values="3;4;3" dur="2s" begin="1s" repeatCount="indefinite"/>
			</circle>`;
			break;
		case 'plus':
			path = `<path d="M12 5v14m-7-7h14" stroke="${color}" stroke-width="2.5" stroke-linecap="round" fill="none">
				<animateTransform attributeName="transform" type="rotate" values="0 12 12;180 12 12;360 12 12" dur="3s" repeatCount="indefinite"/>
			</path>`;
			break;
		case 'block':
			path = `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2" fill="none"/>
			<path d="M9 9l6 6m0-6l-6 6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
			break;
		case 'mute':
			path = `<path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
			<path d="M23 9l-6 6M17 9l6 6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
			break;
		case 'whitelist':
			path = `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2" fill="none"/>
			<path d="M9 12l2 2 4-4" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
			break;
		case 'loading':
			svg.innerHTML = `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416">
				<animate attributeName="stroke-dasharray" dur="1.5s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
				<animate attributeName="stroke-dashoffset" dur="1.5s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
			</circle>`;
			return svg;
	}
	
	svg.innerHTML = path;
	return svg;
}

// Create expanded action button
function createExpandedButton(config, theme, index) {
	const button = document.createElement("div");
	button.className = 'expanded-action-btn';
	button.style.cssText = `
		display: flex;
		align-items: center;
		padding: 12px 16px;
		background: linear-gradient(135deg, ${theme.colors[config.color]}, ${theme.colors[config.color]}dd);
		border-radius: 28px;
		color: white;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		border: 2px solid ${theme.colors.border};
		backdrop-filter: blur(16px);
		box-shadow: 
			0 4px 20px rgba(0, 0, 0, ${theme.isDark ? '0.3' : '0.15'}),
			0 1px 4px rgba(0, 0, 0, ${theme.isDark ? '0.2' : '0.1'});
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		transform: translateX(20px) scale(0.9);
		opacity: 0;
		pointer-events: auto;
		min-width: 120px;
		position: relative;
		overflow: hidden;
		white-space: nowrap;
	`;

	// Icon
	const icon = createMorphingSVGIcon(config.type, 20, 'white');
	icon.style.marginRight = '8px';
	icon.style.flexShrink = '0';

	// Text label
	const label = document.createElement('span');
	label.textContent = config.text;
	label.style.cssText = `
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
		font-weight: 600;
	`;

	// Shimmer effect
	const shimmer = document.createElement('div');
	shimmer.style.cssText = `
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
		background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
		transition: left 0.6s ease;
	`;

	button.appendChild(shimmer);
	button.appendChild(icon);
	button.appendChild(label);

	// Hover effects
	button.addEventListener('mouseenter', () => {
		button.style.transform = 'translateX(0) scale(1.05)';
		button.style.boxShadow = `
			0 8px 32px ${theme.colors[config.color]}40,
			0 4px 16px rgba(0, 0, 0, ${theme.isDark ? '0.4' : '0.2'})`;
		shimmer.style.left = '100%';
		resetAutoCollapseTimer();
	});

	button.addEventListener('mouseleave', () => {
		button.style.transform = 'translateX(0) scale(1)';
		button.style.boxShadow = `
			0 4px 20px rgba(0, 0, 0, ${theme.isDark ? '0.3' : '0.15'}),
			0 1px 4px rgba(0, 0, 0, ${theme.isDark ? '0.2' : '0.1'})`;
		shimmer.style.left = '-100%';
	});

	// Click handler with ripple effect
	button.addEventListener('click', async (e) => {
		// Create ripple effect
		const ripple = document.createElement('div');
		const rect = button.getBoundingClientRect();
		const size = Math.max(rect.width, rect.height);
		const x = e.clientX - rect.left - size / 2;
		const y = e.clientY - rect.top - size / 2;
		
		ripple.style.cssText = `
			position: absolute;
			left: ${x}px;
			top: ${y}px;
			width: ${size}px;
			height: ${size}px;
			border-radius: 50%;
			background: rgba(255, 255, 255, 0.3);
			transform: scale(0);
			animation: rippleEffect 0.6s ease-out;
			pointer-events: none;
		`;
		
		button.appendChild(ripple);
		setTimeout(() => ripple.remove(), 600);

		// Execute action
		await executeButtonAction(button, config, icon, label);
		resetAutoCollapseTimer();
	});

	return button;
}

// Execute button action with state management
async function executeButtonAction(button, config, icon, label) {
	const originalText = label.textContent;
	const originalIcon = icon.cloneNode(true);
	
	// Loading state
	button.style.pointerEvents = 'none';
	button.style.opacity = '0.8';
	
	const loadingIcon = createMorphingSVGIcon('loading', 20, 'white');
	button.replaceChild(loadingIcon, icon);
	label.textContent = 'Processing...';

	try {
		await config.action();
		
		// Success state
		const successIcon = createMorphingSVGIcon('whitelist', 20, 'white');
		button.replaceChild(successIcon, loadingIcon);
		label.textContent = 'Success!';
		button.style.background = `linear-gradient(135deg, #00ba7c, #00ba7cdd)`;
		
		setTimeout(() => {
			button.replaceChild(originalIcon, successIcon);
			label.textContent = originalText;
			button.style.background = `linear-gradient(135deg, ${detectTheme().colors[config.color]}, ${detectTheme().colors[config.color]}dd)`;
			button.style.pointerEvents = 'auto';
			button.style.opacity = '1';
		}, 2000);
		
	} catch (error) {
		// Error state
		const errorIcon = createMorphingSVGIcon('block', 20, 'white');
		button.replaceChild(errorIcon, loadingIcon);
		label.textContent = 'Error!';
		button.style.background = `linear-gradient(135deg, #f4212e, #f4212edd)`;
		
		setTimeout(() => {
			button.replaceChild(originalIcon, errorIcon);
			label.textContent = originalText;
			button.style.background = `linear-gradient(135deg, ${detectTheme().colors[config.color]}, ${detectTheme().colors[config.color]}dd)`;
			button.style.pointerEvents = 'auto';
			button.style.opacity = '1';
		}, 2000);
	}
}

// Toggle dashboard expansion
function toggleDashboard() {
	const expandedContainer = document.getElementById('expanded-buttons');
	const mainFAB = document.getElementById('main-fab');
	const mainIcon = mainFAB.querySelector('svg');
	
	if (!expandedContainer || !mainFAB) return;

	dashboardState.isExpanded = !dashboardState.isExpanded;
	
	if (dashboardState.isExpanded) {
		// Expand
		expandedContainer.style.opacity = '1';
		expandedContainer.style.transform = 'translateY(0) scale(1)';
		expandedContainer.style.pointerEvents = 'auto';
		
		// Animate buttons in sequence
		const buttons = expandedContainer.querySelectorAll('.expanded-action-btn');
		buttons.forEach((button, index) => {
			setTimeout(() => {
				button.style.opacity = '1';
				button.style.transform = 'translateX(0) scale(1)';
			}, index * 100);
		});
		
		// Transform main FAB
		mainFAB.style.transform = 'scale(0.9) rotate(45deg)';
		mainFAB.style.background = `linear-gradient(135deg, ${detectTheme().colors.success}, ${detectTheme().colors.success}dd)`;
		mainIcon.style.transform = 'rotate(-45deg)';
		
		// Start auto-collapse timer
		startAutoCollapseTimer();
		
	} else {
		// Collapse
		const buttons = expandedContainer.querySelectorAll('.expanded-action-btn');
		buttons.forEach((button, index) => {
			setTimeout(() => {
				button.style.opacity = '0';
				button.style.transform = 'translateX(20px) scale(0.9)';
			}, index * 50);
		});
		
		setTimeout(() => {
			expandedContainer.style.opacity = '0';
			expandedContainer.style.transform = 'translateY(20px) scale(0.8)';
			expandedContainer.style.pointerEvents = 'none';
		}, 150);
		
		// Transform main FAB back
		mainFAB.style.transform = 'scale(1) rotate(0deg)';
		mainFAB.style.background = `linear-gradient(135deg, ${detectTheme().colors.primary}, ${detectTheme().colors.primary}dd)`;
		mainIcon.style.transform = 'rotate(0deg)';
		
		// Clear auto-collapse timer
		clearAutoCollapseTimer();
	}
}

// Auto-collapse timer management
function startAutoCollapseTimer() {
	clearAutoCollapseTimer();
	dashboardState.autoCollapseTimer = setTimeout(() => {
		if (dashboardState.isExpanded) {
			toggleDashboard();
		}
	}, 8000); // 8 seconds of inactivity
}

function resetAutoCollapseTimer() {
	if (dashboardState.isExpanded) {
		startAutoCollapseTimer();
	}
}

function clearAutoCollapseTimer() {
	if (dashboardState.autoCollapseTimer) {
		clearTimeout(dashboardState.autoCollapseTimer);
		dashboardState.autoCollapseTimer = null;
	}
}

// Floating Action Dashboard
function addButtons() {
	// Remove existing container
	const existing = document.getElementById('xblocker-dashboard');
	if (existing) {
		existing.remove();
	}

	const theme = detectTheme();
	
	// Create main dashboard container
	const dashboard = document.createElement("div");
	dashboard.id = 'xblocker-dashboard';
	dashboard.style.cssText = `
		position: fixed;
		bottom: 32px;
		right: 32px;
		z-index: 10000;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		pointer-events: none;
	`;

	// Main FAB (Floating Action Button)
	const mainFAB = document.createElement("div");
	mainFAB.id = 'main-fab';
	mainFAB.style.cssText = `
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primary}dd);
		backdrop-filter: blur(20px);
		border: 2px solid ${theme.colors.border};
		box-shadow: 
			0 8px 32px rgba(0, 0, 0, ${theme.isDark ? '0.4' : '0.2'}),
			0 2px 8px rgba(0, 0, 0, ${theme.isDark ? '0.3' : '0.1'}),
			inset 0 1px 0 rgba(255, 255, 255, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: auto;
		position: relative;
		overflow: hidden;
		transform-origin: center;
	`;

	// Ripple effect layer
	const rippleLayer = document.createElement("div");
	rippleLayer.style.cssText = `
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		border-radius: 50%;
		background: radial-gradient(circle, transparent 0%, rgba(255, 255, 255, 0.1) 70%, transparent 100%);
		opacity: 0;
		transform: scale(0);
		transition: all 0.6s ease;
	`;

	// Pulsing ring
	const pulseRing = document.createElement("div");
	pulseRing.style.cssText = `
		position: absolute;
		top: -4px;
		left: -4px;
		right: -4px;
		bottom: -4px;
		border: 2px solid ${theme.colors.primary};
		border-radius: 50%;
		opacity: 0;
		transform: scale(0.8);
		animation: pulse 2s ease-in-out infinite;
	`;

	// Main icon
	const mainIcon = createMorphingSVGIcon('dashboard', 28, 'white');
	mainIcon.style.cssText += `
		z-index: 2;
		position: relative;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
	`;

	mainFAB.appendChild(rippleLayer);
	mainFAB.appendChild(pulseRing);
	mainFAB.appendChild(mainIcon);

	// Expanded buttons container
	const expandedContainer = document.createElement("div");
	expandedContainer.id = 'expanded-buttons';
	expandedContainer.style.cssText = `
		position: absolute;
		bottom: 80px;
		right: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
		opacity: 0;
		transform: translateY(20px) scale(0.8);
		transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
	`;

	dashboard.appendChild(expandedContainer);
	dashboard.appendChild(mainFAB);

	// Create action buttons
	const buttonConfigs = [
		{ type: 'block', color: 'danger', text: 'Block', action: blockFirst20CommentTweets },
		{ type: 'mute', color: 'warning', text: 'Mute', action: muteFirst50CommentTweets },
		{ type: 'whitelist', color: 'success', text: 'Whitelist', action: () => showWhitelistModal() }
	];

	buttonConfigs.forEach((config, index) => {
		const actionButton = createExpandedButton(config, theme, index);
		expandedContainer.appendChild(actionButton);
	});

	// Main FAB click handler
	mainFAB.addEventListener('click', () => {
		toggleDashboard();
	});

	// Hover effects for main FAB
	mainFAB.addEventListener('mouseenter', () => {
		if (!dashboardState.isExpanded) {
			mainFAB.style.transform = 'scale(1.1)';
			mainFAB.style.boxShadow = `
				0 12px 40px rgba(0, 0, 0, ${theme.isDark ? '0.5' : '0.25'}),
				0 4px 12px rgba(0, 0, 0, ${theme.isDark ? '0.4' : '0.15'}),
				inset 0 1px 0 rgba(255, 255, 255, 0.3)`;
			rippleLayer.style.opacity = '1';
			rippleLayer.style.transform = 'scale(1)';
			pulseRing.style.opacity = '0.6';
			pulseRing.style.transform = 'scale(1.2)';
		}
		resetAutoCollapseTimer();
	});

	mainFAB.addEventListener('mouseleave', () => {
		if (!dashboardState.isExpanded) {
			mainFAB.style.transform = 'scale(1)';
			mainFAB.style.boxShadow = `
				0 8px 32px rgba(0, 0, 0, ${theme.isDark ? '0.4' : '0.2'}),
				0 2px 8px rgba(0, 0, 0, ${theme.isDark ? '0.3' : '0.1'}),
				inset 0 1px 0 rgba(255, 255, 255, 0.2)`;
			rippleLayer.style.opacity = '0';
			rippleLayer.style.transform = 'scale(0)';
			pulseRing.style.opacity = '0';
			pulseRing.style.transform = 'scale(0.8)';
		}
	});

	document.body.appendChild(dashboard);

	// Add CSS animations and styles
	if (!document.getElementById('xblocker-styles')) {
		const style = document.createElement('style');
		style.id = 'xblocker-styles';
		style.textContent = `
			@keyframes slideIn {
				from { transform: translateY(20px); opacity: 0; }
				to { transform: translateY(0); opacity: 1; }
			}
			.xb-button {
				transition: all 0.2s ease;
				transform: translateY(0);
			}
			.xb-button:hover {
				transform: translateY(-2px);
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
			}
			.xb-button:active {
				transform: translateY(0);
			}
			.xb-button:disabled {
				opacity: 0.6;
				cursor: not-allowed;
				transform: none !important;
			}
			.xb-progress {
				width: 100%;
				height: 3px;
				background: rgba(255, 255, 255, 0.2);
				border-radius: 2px;
				overflow: hidden;
				margin-top: 4px;
			}
			.xb-progress-bar {
				height: 100%;
				background: linear-gradient(90deg, #1DA1F2, #14B8A6);
				transition: width 0.3s ease;
				width: 0%;
			}
		`;
		document.head.appendChild(style);
		
		// Add additional dashboard-specific styles
		const dashboardStyle = document.createElement('style');
		dashboardStyle.id = 'xblocker-dashboard-styles';
		dashboardStyle.textContent = `
			@keyframes pulse {
				0%, 100% { 
					opacity: 0;
					transform: scale(0.8);
				}
				50% { 
					opacity: 0.6;
					transform: scale(1.2);
				}
			}
			@keyframes rippleEffect {
				from { 
					transform: scale(0);
					opacity: 1;
				}
				to { 
					transform: scale(2);
					opacity: 0;
				}
			}
			@keyframes breathe {
				0%, 100% { transform: scale(1); }
				50% { transform: scale(1.05); }
			}
			@keyframes glow {
				0%, 100% { 
					filter: drop-shadow(0 0 5px currentColor);
				}
				50% { 
					filter: drop-shadow(0 0 15px currentColor);
				}
			}
			
			#main-fab {
				animation: breathe 4s ease-in-out infinite;
			}
			#main-fab:hover {
				animation: none;
			}
			.expanded-action-btn:hover svg {
				animation: glow 1.5s ease-in-out infinite;
			}
		`;
		document.head.appendChild(dashboardStyle);
	}

	// Dashboard is now complete and ready to use
	console.log('XBlocker Dashboard initialized with expandable interface');
}

// All button functionality now handled by expandable dashboard

// Function to show whitelist modal
function showWhitelistModal() {
	// Remove existing modal if it exists
	const existingModal = document.getElementById('xblocker-modal');
	if (existingModal) {
		existingModal.remove();
	}

	const theme = detectTheme();
	const modal = document.createElement('div');
	modal.id = 'xblocker-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, ${theme.isDark ? '0.7' : '0.5'});
		z-index: 10001;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(8px);
		animation: fadeIn 0.2s ease-out;
	`;

	const modalContent = document.createElement('div');
	modalContent.style.cssText = `
		background: ${theme.colors.background};
		border-radius: 16px;
		padding: 24px;
		width: 90%;
		max-width: 400px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, ${theme.isDark ? '0.5' : '0.3'});
		border: 1px solid ${theme.colors.border};
		color: ${theme.colors.text};
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		animation: slideInModal 0.3s ease-out;
	`;

	// Add modal animations to existing styles
	const existingStyle = document.getElementById('xblocker-styles');
	if (existingStyle && !existingStyle.textContent.includes('fadeIn')) {
		existingStyle.textContent += `
			@keyframes fadeIn {
				from { opacity: 0; }
				to { opacity: 1; }
			}
			@keyframes slideInModal {
				from { transform: translateY(-20px) scale(0.95); opacity: 0; }
				to { transform: translateY(0) scale(1); opacity: 1; }
			}
		`;
	}

	modalContent.innerHTML = `
		<h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: ${theme.colors.text};">Add User to Whitelist</h3>
		<p style="margin: 0 0 16px 0; color: ${theme.colors.textSecondary}; font-size: 14px;">Enter a username to prevent them from being blocked or muted</p>
		<input type="text" id="username-input" placeholder="Enter username (without @)" 
			style="width: 100%; padding: 12px; border: 1px solid ${theme.colors.border}; 
			border-radius: 8px; background: ${theme.colors.surface}; color: ${theme.colors.text}; 
			font-size: 14px; margin-bottom: 16px; box-sizing: border-box;
			outline: none; transition: border-color 0.2s ease;">
		<div style="display: flex; gap: 12px; justify-content: flex-end;">
			<button id="cancel-btn" style="padding: 8px 16px; background: transparent; 
				color: ${theme.colors.textSecondary}; border: 1px solid ${theme.colors.border}; border-radius: 6px; 
				cursor: pointer; font-size: 14px; transition: all 0.2s ease;">Cancel</button>
			<button id="add-btn" style="padding: 8px 16px; background: linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd); 
				color: white; border: none; border-radius: 6px; cursor: pointer; 
				font-size: 14px; font-weight: 600; transition: all 0.2s ease;">Add to Whitelist</button>
		</div>
	`;

	modal.appendChild(modalContent);
	document.body.appendChild(modal);

	const input = document.getElementById('username-input');
	const cancelBtn = document.getElementById('cancel-btn');
	const addBtn = document.getElementById('add-btn');

	// Focus input
	input.focus();

	// Style input focus
	input.addEventListener('focus', () => {
		input.style.borderColor = theme.colors.success;
	});
	input.addEventListener('blur', () => {
		input.style.borderColor = theme.colors.border;
	});

	// Button hover effects
	cancelBtn.addEventListener('mouseenter', () => {
		cancelBtn.style.background = theme.colors.surface;
		cancelBtn.style.color = theme.colors.text;
	});
	cancelBtn.addEventListener('mouseleave', () => {
		cancelBtn.style.background = 'transparent';
		cancelBtn.style.color = theme.colors.textSecondary;
	});

	addBtn.addEventListener('mouseenter', () => {
		addBtn.style.transform = 'translateY(-1px)';
		addBtn.style.boxShadow = `0 4px 12px ${theme.colors.success}30`;
		addBtn.style.background = `linear-gradient(135deg, ${theme.colors.success}ee, ${theme.colors.success}cc)`;
	});
	addBtn.addEventListener('mouseleave', () => {
		addBtn.style.transform = 'translateY(0)';
		addBtn.style.boxShadow = 'none';
		addBtn.style.background = `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`;
	});

	// Event handlers
	const closeModal = () => modal.remove();
	
	cancelBtn.addEventListener('click', closeModal);
	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeModal();
	});

	addBtn.addEventListener('click', () => {
		const username = input.value.trim();
		if (username) {
			addToWhitelist(username);
			closeModal();
		}
	});

	input.addEventListener('keypress', (e) => {
		if (e.key === 'Enter') {
			const username = input.value.trim();
			if (username) {
				addToWhitelist(username);
				closeModal();
			}
		} else if (e.key === 'Escape') {
			closeModal();
		}
	});

	// Close on escape key
	document.addEventListener('keydown', function escapeHandler(e) {
		if (e.key === 'Escape') {
			closeModal();
			document.removeEventListener('keydown', escapeHandler);
		}
	});
}

// Theme change observer
function observeThemeChanges() {
	const observer = new MutationObserver(() => {
		// Check if theme has changed and update buttons accordingly
		const existingContainer = document.getElementById('xblocker-buttons');
		if (existingContainer) {
			// Refresh buttons with new theme
			setTimeout(() => {
				addButtons();
			}, 100);
		}
	});

	// Observe changes to document attributes that might indicate theme changes
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['style', 'class', 'data-theme']
	});

	observer.observe(document.body, {
		attributes: true,
		attributeFilter: ['style', 'class', 'data-theme']
	});

	return observer;
}

// Update checkPageAndAddButton function
function checkPageAndAddButton() {
	const url = window.location.href;
	const tweetPagePattern = /https?:\/\/(www\.)?x\.com\/[^\/]+\/status\/\d+/;
	const timelinePattern = /https?:\/\/(www\.)?x\.com\/i\/timeline/;

	if (timelinePattern.test(url)) {
		// Do not add buttons or run code on the timeline page
		console.log("On timeline page. Exiting.");
		return;
	}

	// Add buttons on tweet pages and user feed pages
	if (
		tweetPagePattern.test(url) ||
		/^https?:\/\/(www\.)?x\.com\/[^\/]+\/?$/.test(url)
	) {
		addButtons();
		// Start theme observation
		observeThemeChanges();
	}
}

// Run the main functions
checkPageAndAddButton();

// Listen for URL changes (for single-page applications)
let lastUrl = location.href;
new MutationObserver(() => {
	const url = location.href;
	if (url !== lastUrl) {
		lastUrl = url;
		checkPageAndAddButton();
	}
}).observe(document, { subtree: true, childList: true });
