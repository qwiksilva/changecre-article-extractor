const Apify = require('apify');
const extractor = require('unfluff');
const chrono = require('chrono-node');
const urlLib = require('url');
const moment = require('moment');
var axios = require('axios');
var qs = require('qs');

const { parseDateToMoment, loadAllDataset, executeExtendOutputFn, isDateValid, findDateInURL, parseDomain, completeHref } = require('./utils.js');
const { countWords, isUrlArticle, isInDateRange } = require('./article-recognition.js');
const CUNotification = require('./compute-units-notification.js');
const { MAX_DATASET_ITEMS_LOADED, GOOGLE_BOT_HEADERS, test_input } = require('./constants.js');

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    console.log('input');
    console.dir(input);

    const {
        // These are category URLs mostly
        startUrls = [],
        articleUrls = [],
        bubbleEndpoint,
        gsheetsEndpoint,
        apiEndpoint = false,
        classifierAPIConfig,
        summaryAPIConfig,
        datasetId = null,
        onlyNewArticles = false,
        onlyInsideArticles = true,
        saveHtml = false,
        useGoogleBotHeaders = false,
        minWords = 150,
        dateFrom,
        isUrlArticleDefinition,
        mustHaveDate = true,
        pseudoUrls,
        linkSelector,
        maxDepth,
        maxPagesPerCrawl,
        maxArticlesPerCrawl,
        proxyConfiguration = { useApifyProxy: true },
        debug = false,
        maxConcurrency,
        extendOutputFunction,

        // browser options
        useBrowser = false,
        pageWaitMs,
        pageWaitSelector,
        gotoFunction,

        // notification options for J.S.
        stopAfterCUs,
        notifyAfterCUs,
        notificationEmails,
        notifyAfterCUsPeriodically,
    } = input || test_input ;

    var dataset = null;
    if (datasetId) {
        dataset = await Apify.openDataset(datasetId);
    } else {
        dataset = await Apify.openDataset();
    }
    
    const defaultNotificationState = {
        next: notifyAfterCUsPeriodically,
        wasNotified: false,
    };

    const notificationState = (await Apify.getValue('NOTIFICATION-STATE')) || defaultNotificationState;

    // Measure CUs every 30 secs if enabled in input
    if (stopAfterCUs || notifyAfterCUs || notifyAfterCUsPeriodically) {
        if (Apify.isAtHome()) {
            setInterval(async () => {
                await CUNotification(stopAfterCUs, notifyAfterCUs, notificationEmails, notifyAfterCUsPeriodically, notificationState);
            }, 30000);
        } else {
            console.log('Cannot measure Compute units of local run. Notifications disabled...');
        }
    }

    let articlesScraped = (await Apify.getValue('ARTICLES-SCRAPED')) || 0;
    Apify.events.on('migrating', async () => {
        await Apify.setValue('ARTICLES-SCRAPED', articlesScraped);
    });

    let extendOutputFunctionEvaled;
    if (extendOutputFunction) {
        try {
            extendOutputFunctionEvaled = eval(extendOutputFunction);
        } catch (e) {
            throw new Error(`extendOutputFunction is not a valid JavaScript! Error: ${e}`);
        }
        if (typeof extendOutputFunctionEvaled !== 'function') {
            throw new Error(`extendOutputFunction is not a function! Please fix it or use just default output!`);
        }
    }

    // Valid format is either YYYY-MM-DD or format like "1 week" or "20 days"
    const parsedDateFrom = parseDateToMoment(dateFrom);
    // console.log(parsedDateFrom);

    const arePseudoUrls = pseudoUrls && pseudoUrls.length > 0;
    if ((arePseudoUrls && !linkSelector) || (linkSelector && !arePseudoUrls)) {
        console.log('WARNING - If you use only Pseudo URLs or only Link selector, they will not work. You need to use them together.');
    }

    // Only relevant for incremental run
    const state = {};
    let stateDataset;
    if (onlyNewArticles) {
        console.log('loading state dataset...');
        const datasetToOpen = 'articles-state';
        stateDataset = await Apify.openDataset(datasetToOpen);
        const { itemCount } = await stateDataset.getInfo();
        const rawOffset = itemCount - MAX_DATASET_ITEMS_LOADED;
        const offset = rawOffset < 0 ? 0 : rawOffset;
        console.log(`State dataset contains ${itemCount} items, max dataset load is ${MAX_DATASET_ITEMS_LOADED}, offset: ${offset}`);
        const stateData = await loadAllDataset(stateDataset, [], offset);
        stateData.forEach((item) => {
            state[item.url] = true;
        });
        console.log('state prepared');
    }

    console.log(`We got ${startUrls.concat(articleUrls).length} start URLs`);

    const requestQueue = await Apify.openRequestQueue();

    for (const request of startUrls) {
        const { url } = request;
        console.log(`Enquing start URL: ${url}`);

        await requestQueue.addRequest({
            url,
            userData: {
                // This is here for backwards compatibillity
                label: request.userData && request.userData.label === 'ARTICLE' ? 'ARTICLE' : 'CATEGORY',
                index: 0,
                depth: 0,
            },
            headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : undefined,
        });

    }

    let index = 0;
    for (const request of articleUrls) {
        const { url } = request;
        console.log(`Enquing article URL: ${url}`);

        const label = {label: 'ARTICLE', index: 0};
        await requestQueue.addRequest({
            url,
            userData: {...label, ...request.userData},
            headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : undefined,
        });
        index++;
    }

    // This can be Cheerio or Puppeteer page so we have to differentiate that often
    // That's why there will be often "if (page) {...}"
    const handlePageFunction = async ({ request, $, body, page }) => {
        if (page && (pageWaitSelector)) {
            await page.waitFor(pageWaitSelector);
        }

        if (page && (pageWaitMs)) {
            await page.waitFor(pageWaitMs);
        }

        const html = page ? await page.content() : body;

        const title = page
            ? await page.title()
            : $('title').text();

        const { loadedUrl } = request;

        if (title.includes('Attention Required!')) {
            throw new Error('We got captcha on:', request.url);
        }

        if (request.userData.label !== 'ARTICLE') {
            const loadedDomain = parseDomain(loadedUrl);
            console.log(`CATEGORY PAGE - requested URL: ${request.url}, loaded URL: ${loadedUrl}`);

            if (request.userData.depth >= maxDepth) {
                console.log(`Max depth of ${maxDepth} reached, not enqueueing any more request for --- ${request.url}`);
                return;
            }

            // all links
            let allHrefs = [];
            let aTagsCount = 0;
            if (page) {
                allHrefs = await page.$$eval('a', (els) => els.map((el) => el.href));
            } else {
                $('a').each(function () {
                    aTagsCount++;
                    const relativeOrAbsoluteLink = $(this).attr('href');
                    if (relativeOrAbsoluteLink) {
                        const absoluteLink = urlLib.resolve(loadedUrl, relativeOrAbsoluteLink);
                        allHrefs.push(absoluteLink);
                    }
                });
            }
            console.log(`total number of a tags: ${aTagsCount}`);
            console.log(`total number of links: ${allHrefs.length}`);

            let links = allHrefs;

            // filtered only inside links
            if (onlyInsideArticles) {
                links = allHrefs.filter((link) => loadedDomain === parseDomain(link));
                console.log(`number of inside links: ${links.length}`);
            }
            
            // filtered only new urls
            if (onlyNewArticles) {
                links = links.filter((href) => !state[href]);
                console.log(`number of inside links after state filter: ${links.length}`);
            }

            // filtered only proper article urls
            const articleUrlHrefs = links.filter((link) => isUrlArticle(link, isUrlArticleDefinition));
            console.log(`number of article url links: ${articleUrlHrefs.length}`);

            let index = 0;
            for (const url of articleUrlHrefs) {
                index++;
                await requestQueue.addRequest({
                    url,
                    userData: {
                        domain: request.userData.domain,
                        label: 'ARTICLE',
                        index,
                        loadedDomain,
                        headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : {},
                    },
                });
            }
            if (debug) {
                await Apify.setValue(Math.random().toString(), html || await page.content(), { contentType: 'text/html' });
            }

            // We handle optional pseudo URLs and link selectors here
            if (pseudoUrls && pseudoUrls.length > 0 && linkSelector) {
                let selectedLinks;
                if (page) {
                    selectedLinks = await page.$$eval(linkSelector, (els) => els.map((el) => el.href).filter((link) => !!link));
                } else {
                    selectedLinks = $(linkSelector)
                        .map(function () { return $(this).attr('href'); }).toArray()
                        .filter((link) => !!link)
                        .map((link) => link.startsWith('http') ? link : completeHref(request.url, link));
                }
                const purls = pseudoUrls.map((req) => new Apify.PseudoUrl(
                    req.url,
                    { userData: req.userData, depth: request.userData.depth + 1 }
                ));

                let enqueued = 0;
                for (const url of selectedLinks) {
                    for (const purl of purls) {
                        if (purl.matches(url)) {
                            // userData are passed along
                            await requestQueue.addRequest(purl.createRequest(url));
                            enqueued++;
                            break; // We finish the inner loop because the first PURL that matches wons
                        }
                    }
                }
                console.log(`Link selector found ${selectedLinks.length} links, enqueued through PURLs: ${enqueued} --- ${request.url}`);
            }
        }

        if (request.userData.label === 'ARTICLE') {
            const metadata = extractor(html);

            const result = {
                url: request.url,
                loadedUrl,
                domain: request.userData.domain ? request.userData.domain : request.userData.loadedDomain,
                loadedDomain: request.userData.loadedDomain,
                ...metadata,
                html: saveHtml ? html : undefined,
            };
            const overrideFields = {        
                'links': undefined,
                'videos': undefined,
                'tags': undefined,
                'favicon': undefined,
                'copyright':undefined
            }
            let userResult = {};
            if (extendOutputFunction) {
                if (page) {
                    await Apify.utils.puppeteer.injectJQuery(page);
                    const pageFunctionString = extendOutputFunction.toString();

                    const evaluatePageFunction = async (fnString) => {
                        const fn = eval(fnString);
                        try {
                            const fnResult = await fn($, result);
                            return { fnResult };
                        } catch (e) {
                            return { error: e.toString()};
                        }
                    }
                    const { result, error } = await page.evaluate(evaluatePageFunction, pageFunctionString);
                    if (error) {
                        console.log(`extendOutputFunction failed. Returning default output. Error: ${error}`);
                    } else {
                        userResult = result;
                    }
                } else {
                    userResult = await executeExtendOutputFn(extendOutputFunctionEvaled, $, result);
                }
            }

            const completeResult = { ...result, ...overrideFields, ...request.userData, ...userResult };

            console.log('Raw date:', completeResult.date);

            // We try native new Date() first and then Chrono
            let parsedPageDate;
            if (completeResult.date) {
                const nativeDate = new Date(completeResult.date);
                if (isDateValid(nativeDate)) {
                    parsedPageDate = moment(nativeDate.toISOString());
                } else {
                    parsedPageDate = chrono.parseDate(completeResult.date);
                }
            }

            if (!parsedPageDate) {
                parsedPageDate = findDateInURL(request.url);
            }

            completeResult.date = parsedPageDate || null;

            console.log('Parsed date:', metadata.date);

            const wordsCount = countWords(completeResult.text);

            const isInDateRangeVar = isInDateRange(completeResult.date, parsedDateFrom);
            if (mustHaveDate && !completeResult.date) {
                console.log(`ARTICLE - ${request.userData.index} - DATE NOT IN RANGE: ${completeResult.date}`);
                return;
            }

            if (onlyNewArticles) {
                state[completeResult.url] = true;
                await stateDataset.pushData({ url: request.url });
            }

            const hasValidDate = mustHaveDate ? isInDateRangeVar : true;

            const isArticle =
                hasValidDate
                && !!completeResult.title
                && wordsCount > minWords;

            if (isArticle || 'Headline' in request.userData) {
                console.log(`IS VALID ARTICLE --- ${request.url}`);

                const now = new Date();
                completeResult['Date'] = (completeResult.date || completeResult['Date']) || moment(now.toISOString())

                if (classifierAPIConfig && completeResult.text) {
                    classifierAPIConfig["data"] = qs.stringify({
                        'text': completeResult.text 
                    });
                    try {
                        const response = await axios(classifierAPIConfig);
                        console.log("Data sent to Aylien with response:")
                        console.log(JSON.stringify(response.data));
                        completeResult['Worth Reading AI'] = response.data["categories"][0]["label"];
                        completeResult['Worth Reading AI Confidence'] = response.data["categories"][0]["confidence"];
                    } catch(error) {
                        console.log("Aylien API error", error);
                    }
                } 

                if (summaryAPIConfig && completeResult.text) {
                    summaryAPIConfig["data"] = qs.stringify({
                        'text': completeResult.text 
                    });
                    try {
                        const response = await axios(summaryAPIConfig);
                        console.log("Data sent to Text Summary API with response:")
                        console.log(JSON.stringify(response.data));
                        completeResult['Summary Text'] = response.data["output"];
                    } catch(error) {
                        console.log("Text Summary API error", error);
                    }
                }

                await dataset.pushData(completeResult);

                if (bubbleEndpoint) {
                    const bubble_data = {
                        'Url': completeResult['Url'] || completeResult.loadedUrl,
                        'Date': completeResult['Date'],
                        'Headline': completeResult['Headline'] || completeResult.title,
                        'Media Outlet': completeResult['Media Outlet'] || completeResult.domain,
                        'Worth Reading': completeResult['Worth Reading'],
                        'Worth Reading AI': completeResult['Worth Reading AI'],
                        'Worth Reading AI Confidence': completeResult['Worth Reading AI Confidence'],
                        'Summary Text': completeResult['Summary Text'],
                        'Subcategories': completeResult['Subcategories'],
                        'Text': completeResult.text,
                        'Iframley Author': completeResult.author[0],
                        'Iframely Description': completeResult.description,
                        'Iframely Thumbnail': completeResult.image,
                        'Source': completeResult['Source'] || 'Crawler',
                    };
                    
                    const bubble_config = {
                        method: 'post',
                        url: bubbleEndpoint,
                        headers: { 
                            'Content-Type': 'application/json'
                        },
                        data: JSON.stringify(bubble_data)
                    };
                    try {
                        const response = await axios(bubble_config);
                        console.log("Data sent to Bubble with response:")
                        console.log(JSON.stringify(response.data));

                        if (gsheetsEndpoint) {
                            const sheets_config = {
                                method: 'post',
                                url: gsheetsEndpoint,
                                headers: { 
                                    'Content-Type': 'application/json'
                                },
                                params: {
                                    'url': completeResult.url,
                                    'bubbleID': response.data.id
                                }
                            };
                            const sheets_response = await axios(sheets_config);
                            console.log("Data sent to Sheets with response:")
                            console.log(JSON.stringify(sheets_response.data));
                        }
                    } catch(error) {
                        console.log("Bubble error", error.response.data.body);
                    }
                }
                
                if (apiEndpoint) {
                    var config = {
                        method: 'post',
                        url: apiEndpoint,
                        headers: { 
                            'Content-Type': 'application/json'
                        },
                        data: JSON.stringify(completeResult)
                    };

                    try {
                        const response = await axios(config);
                        console.log("Data sent to API with response:")
                        console.log(JSON.stringify(response.data));
                    } catch(error) {
                        console.log("API error", error);
                    }
                }

                articlesScraped++;

                if (maxArticlesPerCrawl && articlesScraped >= maxArticlesPerCrawl) {
                    console.log(`WE HAVE REACHED MAXIMUM ARTICLES: ${maxArticlesPerCrawl}. FINISHING CRAWLING...`);
                    process.exit(0);
                }
            } else {
                console.log(`IS NOT VALID ARTICLE --- date: ${hasValidDate}, title: ${!!completeResult.title}, words: ${wordsCount}, dateRange: ${isInDateRangeVar} --- ${request.url}`);
            }
        }
    };

    let proxyConfigurationClass;
    if (proxyConfiguration && (proxyConfiguration.useApifyProxy || Array.isArray(proxyConfiguration.proxyUrls))) {
        proxyConfigurationClass = await Apify.createProxyConfiguration({
            groups: proxyConfiguration.apifyProxyGroups,
            countryCode: proxyConfiguration.apifyProxyCountry,
        });
    }

    const gotoFunctionCode = eval(gotoFunction);

    const handleFailedRequestFunction = async ({request, error}) => {
        if (bubbleEndpoint && 'Headline' in request.userData) {
            const bubble_config = {
                method: 'post',
                url: bubbleEndpoint,
                headers: { 
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(request.userData)
            };
            try {
                const response = await axios(bubble_config);
                console.log("Data sent to Bubble with response:")
                console.log(JSON.stringify(response.data));

                if (gsheetsEndpoint) {
                    const sheets_config = {
                        method: 'post',
                        url: gsheetsEndpoint,
                        headers: { 
                            'Content-Type': 'application/json'
                        },
                        params: {
                            'url': request.url,
                            'bubbleID': response.data.id
                        }
                    };
                    const sheets_response = await axios(sheets_config);
                    console.log("Data sent to Sheets with response:")
                    console.log(JSON.stringify(sheets_response.data));
                }
            } catch(error) {
                console.log("Bubble error", error);
            }
        }
    };

    const genericCrawlerOptions = {
        requestQueue,
        handlePageFunction,
        handleFailedRequestFunction,
        gotoFunction: gotoFunctionCode,
        maxConcurrency,
        maxRequestRetries: 3,
        maxRequestsPerCrawl: maxPagesPerCrawl,
        proxyConfiguration: proxyConfigurationClass,
    }

    const crawler = useBrowser
        ? new Apify.PuppeteerCrawler(genericCrawlerOptions)
        : new Apify.CheerioCrawler(genericCrawlerOptions);

    console.log('starting crawler...');
    await crawler.run();
    console.log('crawler finished...');
});
