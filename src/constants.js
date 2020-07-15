module.exports = {
    GOOGLE_BOT_HEADERS: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Referer': 'https://www.google.com/',
        'X-Forwarded-For': '66.249.66.1',
    },
    MAX_DATASET_ITEMS_LOADED: 3 * 1000 * 1000,
    test_input: {
        startUrls: [{"url": "https://www.nmhc.org/news/newsroom/"}],
        s3storage: false,
        apiEndpoint: false,
        datasetID = undefined,
        onlyNewArticles: false,
        onlyInsideArticles: true,
        saveHtml: false,
        useGoogleBotHeaders: false,
        minWords: 150,
        dateFrom: "2 days",
        isUrlArticleDefinition: {
            "minDashes": 4
        },
        mustHaveDate: true,
        pseudoUrls: false,
        linkSelector: false,
        maxDepth: 3,
        maxPagesPerCrawl: 200,
        maxArticlesPerCrawl: 200,
        proxyConfiguration: { useApifyProxy: false },
        debug: false,
        maxConcurrency: 5,
        extendOutputFunction: false,
        stopAfterCUs: 10,
        notifyAfterCUs: 10,
        notificationEmails: false,
        notifyAfterCUsPeriodically: 10
    }
};
