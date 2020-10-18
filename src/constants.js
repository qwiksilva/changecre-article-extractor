const url = 'https://rebusinessonline.com/event/webinar-what-is-the-outlook-for-the-affordable-housing-sector-in-the-southeast/';

// const userData = {
//     'Worth Reading':'No', 
//     'Headline':'Test', 
//     'Subcategories':'', 
//     'Date':'Wed Sep 02 00:00:00 GMT-07:00 2020', 
//     'Media Outlet':'www.housingfinance.com', 
//     'Url':url
// };

module.exports = {
    GOOGLE_BOT_HEADERS: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Referer': 'https://www.google.com/',
        'X-Forwarded-For': '66.249.66.1',
    },
    MAX_DATASET_ITEMS_LOADED: 3 * 1000 * 1000,
    
    test_input: {
        startUrls: [{'url':'http://rebusinessonline.com'}],
        articleUrls: [],
        // [{
        //     'url':url, 
        //     'userData':userData
        // }],
        bubbleEndpoint: false,//'https://crenews.bubbleapps.io/version-test/api/1.1/obj/articledata?api_token=5c2afeadfe6a1227e630a06ca9978393',
        gsheetsEndpoint: false,
        apiEndpoint: false,
        classifierAPIConfig: false,
        // {
        //     "method": "post",
        //     "url": "https://api.tap.aylien.com/v1/models/fadca576-6a35-4dca-adeb-7c0717beff47",
        //     "headers": { 
        //       "x-aylien-tap-application-key": "0e8765f4b65f4f67866983d1fcbb5b7d", 
        //       "Content-Type": "application/x-www-form-urlencoded"
        //     }
        //   },
        summaryAPIConfig: false,
        // {
        //     "method": 'post',
        //     "url": 'https://api.deepai.org/api/summarization',
        //     "headers": { 
        //       'api-key': '10321a68-a3d8-4d35-9935-1c49bcde9379', 
        //       'Content-Type': 'application/x-www-form-urlencoded'
        //     }
        //   },
        datasetId: false,
        onlyNewArticles: false,
        onlyInsideArticles: true,
        saveHtml: false,
        useGoogleBotHeaders: false,
        minWords: 121,
        dateFrom: false,
        isUrlArticleDefinition: {
            "minDashes":4,
            "mustNotInclude": [
                "/event/"
            ],
            "linkIncludes": [
              "/news/",
              "/pressreleases/"
            ]
          },
        // {
        //     "minDashes":4
        // },
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
        useBrowser: false,
        pageWaitMs: 10000,
        pageWaitSelector: null,
        gotoFunction: ''
    }
};
