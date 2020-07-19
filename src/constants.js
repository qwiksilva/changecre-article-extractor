module.exports = {
    GOOGLE_BOT_HEADERS: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Referer': 'https://www.google.com/',
        'X-Forwarded-For': '66.249.66.1',
    },
    MAX_DATASET_ITEMS_LOADED: 3 * 1000 * 1000,
    test_input: {
        startUrls: [],
        articleUrls: [{"url": "https://www.globest.com/2020/03/30/construction-project-cancellations-rose-sharply-last-week/"}],
        // startUrls: [{"url": "https://www.nmhc.org/news/nmhc-news/2020/more-apartment-operators-move-to-flex-payment-models/", "userData": {"label":"ARTICLE"}}],
        apiEndpoint: false,
        datasetId: false,
        onlyNewArticles: false,
        onlyInsideArticles: true,
        saveHtml: false,
        useGoogleBotHeaders: false,
        minWords: 150,
        dateFrom: false,
        isUrlArticleDefinition: {
            "minDashes": 4
        },
        mustHaveDate: false,
        pseudoUrls: false,
        linkSelector: false,
        maxDepth: 3,
        maxPagesPerCrawl: 200,
        maxArticlesPerCrawl: 200,
        proxyConfiguration: { useApifyProxy: false },
        debug: false,
        maxConcurrency: 5,
        extendOutputFunction: undefined,
        stopAfterCUs: 10,
        notifyAfterCUs: 10,
        notificationEmails: false,
        notifyAfterCUsPeriodically: 10,
        useBrowser: true,
        pageWaitMs: 100,
        pageWaitSelector: undefined,
        gotoFunction: "async ({ page, request }) => {\
            let loginUrl = `https://store.law.com/Registration/Login.aspx?source=${request.url}`;\
            await page.goto(loginUrl);\
            await page.type('#uid', 'sparkpill2@gmail.com');\
            await page.type('#upass', 'changemultifamily123');\
            await page.click('#loginSubmit');\
            await page.waitForNavigation();\
            return page;\
        }",
    }
};
