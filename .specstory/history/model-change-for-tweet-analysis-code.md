## SpecStory

## Model Change for Tweet Analysis Code (2/5/2025, 6:30:49 PM)

_**User**_

chagne the model to deepseek-r1-distill-llama-70b-specdec	

---

_**Assistant**_

Based on the code context provided, I'll help you change the model to deepseek-r1-distill-llama-70b-specdec. The model configuration appears to be in the content.js file where the API call to Groq is made.

Here's how to modify the code:

```javascript:content.js
// Find and modify the model parameter in the analyzeTweet function
const response = await fetch(
  "https://api.groq.com/openai/v1/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: messages,
      model: "deepseek-r1-distill-llama-70b-specdec", // Changed from llama-3.1-8b-instant
      temperature: 1,
      max_tokens: 1024,
      top_p: 1,
      stream: false,
      response_format: {
        type: "json_object",
      },
      stop: null,
    }),
  }
);
```

This change should be made in the analyzeTweet function, which can be found in:

```javascript:content copy.js
startLine: 399
endLine: 467
```

The same change should also be made in:


```234:467:x-ai-filter-userscript.js
    async function analyzeTweet(tweetText, apiKey) {
        let retries = 0;
        const maxRetries = 3;
        const messages = [
            {
                role: "system",
                content: `Your task is to evaluate Tweets/X posts. Always respond in JSON. Follow this format:\n\n{\n${topicsConfig.map(topic => `    "${topic.topic}": 0.0`).join(',\n')}\n}\n\nRate the provided post from 0.0 to 1.0 for each topic. Here are the descriptions for each topic:\n\n${topicsConfig.map(topic => `${topic.topic}: ${topic.description}`).join('\n')}`
            },
            {
                role: "user",
                content: tweetText
            }
        ];

        while (retries < maxRetries) {
            try {
                const response = await new Promise((resolve, reject) => {
                    GM.xmlHttpRequest({
                        method: "POST",
                        url: "https://api.groq.com/openai/v1/chat/completions",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${apiKey}`
                        },
                        data: JSON.stringify({
                            messages: messages,
                            model: "llama-3.1-8b-instant",
                            temperature: 1,
                            max_tokens: 1024,
                            top_p: 1,
                            stream: false,
                            response_format: {
                                type: "json_object"
                            },
                            stop: null
                        }),
                        onload: resolve,
                        onerror: reject
                    });
                });

                if (response.status === 400) {
                    retries++;
                    continue;
                }

                const data = JSON.parse(response.responseText);
                return JSON.parse(data.choices[0].message.content);
            } catch (error) {
                retries++;
                if (retries === maxRetries) {
                    console.error("Max retries reached. Returning empty object.");
                    return {};
                }
            }
        }
        return {};
    }
    async function getGroqApiKey() {
        let apiKey = await GM.getValue('GROQ_API_KEY', null);
        if (!apiKey) {
            apiKey = prompt("Please enter your Groq API key:");
            if (apiKey) {
                await GM.setValue('GROQ_API_KEY', apiKey);
            }
        }
        return apiKey;
    }

    function debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    const debouncedCheck = debounce(checkForNewPosts, 300);

    window.addEventListener('scroll', () => {
        if (window.location.hostname === 'x.com') {
            debouncedCheck();
        }
    });

    if (window.location.hostname === 'x.com') {
        checkForNewPosts();
    }

})();
```


Make sure to test the change thoroughly as different models may have different response characteristics and performance implications. The deepseek model might have different latency and token usage compared to the original llama-3.1-8b-instant model.

---



---

