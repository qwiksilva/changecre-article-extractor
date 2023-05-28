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
    
    // ChangeCRE Documentation
    // Function: handlePageFunction
    // Description: Processes a page found by the scraper, including deciding what type of page it is (ARTICLE or ??),
    //  extracting the article text, processing the article text with AI, and seding the results to the bubble database.
    // Arguments:
    //  request: the request that was used to get the page
    //  $: the jQuery context
    //  body: the html bodty of the page
    // page: ??
    
    // Returns: Nothing
    const handlePageFunction = async ({ request, $, body, page }) => {
        // Wait for JavaScript to load??
        if (page && (pageWaitSelector)) {
            await page.waitFor(pageWaitSelector);
        }

        // Wait an additional munber of milliseconds??
        if (page && (pageWaitMs)) {
            await page.waitFor(pageWaitMs);
        }

        // Get page content (body)
        const html = page ? await page.content() : body;

        // Get the page title
        const title = page
            ? await page.title()
            : $('title').text();

        // Get the current URL
        const { loadedUrl } = request;

        // Check for a capchta, this script does not support getting past captcha so if one exists, throw an error
        if (title.includes('Attention Required!')) {
            throw new Error('We got captcha on:', request.url);
        }

        // If the request/url is a lits of links to other articles (RSS feed, homepage, etc.)
        if (request.userData.label !== 'ARTICLE') {
            // get the domain of the page
            const loadedDomain = parseDomain(loadedUrl);
            console.log(`CATEGORY PAGE - requested URL: ${request.url}, loaded URL: ${loadedUrl}`);

            // only search for maxDepth articles on each page (unsure if this stops recursion/loops)
            if (request.userData.depth >= maxDepth) {
                console.log(`Max depth of ${maxDepth} reached, not enqueueing any more request for --- ${request.url}`);
                return;
            }

            // get all links on the page
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

            // if the option is passed to only get links that point to the same domain as the current one, then filter for only "inside links"
            if (onlyInsideArticles) {
                links = allHrefs.filter((link) => loadedDomain === parseDomain(link));
                console.log(`number of inside links: ${links.length}`);
            }
            
            // if the option is passed to only get links that have never been scrped before, then filter for only new urls
            // This should be on in deployment since links can remain on a main page for days, but this optin is useful to turn off during testing 
            if (onlyNewArticles) {
                links = links.filter((href) => !state[href]);
                console.log(`number of inside links after state filter: ${links.length}`);
            }

            // filtered only proper article urls. See the isUrlArticle function critera on what's considered a proper article
            const articleUrlHrefs = links.filter((link) => isUrlArticle(link, isUrlArticleDefinition));
            console.log(`number of article url links: ${articleUrlHrefs.length}`);

            // Put the found links on the request queue to go scrape he individual article page.
            // A page is treated as an indivudal article if it's label is 'ARTICLE' as done below.
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
            
            // If in debug mode, store the html of the page
            if (debug) {
                await Apify.setValue(Math.random().toString(), html || await page.content(), { contentType: 'text/html' });
            }

            // We handle optional pseudo URLs and link selectors here
            // See original Apify/GitHub for deinfitions of pseudo URLs and link selectors
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

        // Current page is a single article
        if (request.userData.label === 'ARTICLE') {
            
            // Get the page metadata (author, data, etc)
            const metadata = extractor(html);

            // Contruct the result of the parsed article
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
            
            // Parse the page with for additional infor specified from the Apify website/calling context
            // extendOutputFunction is the function a 'user'/calling context can pass that must be a valid javascript function, and it will be executed on the html page contents
            let userResult = {};
            if (extendOutputFunction) {
                if (page) {
                    // inject jQuery into the page
                    await Apify.utils.puppeteer.injectJQuery(page);
                    
                    // Do some setup to actually execute the function
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
                    
                    // execute the provided function on the page
                    const { result, error } = await page.evaluate(evaluatePageFunction, pageFunctionString);
                    
                    // handle any errors gracefully by falling back to default output
                    if (error) {
                        console.log(`extendOutputFunction failed. Returning default output. Error: ${error}`);
                    } else {
                        userResult = result;
                    }
                } else {
                    // Alternate way to evalute user this function??
                    userResult = await executeExtendOutputFn(extendOutputFunctionEvaled, $, result);
                }
            }

            // Combine the result, overrideFields, request.userData, and userResult into single completeResult
            const completeResult = { ...result, ...overrideFields, ...request.userData, ...userResult };

            console.log('Raw date:', completeResult.date);

            // Parse the date the article was published
            // We try native new Date() first and then Chrono for parsing string to date
            let parsedPageDate;
            if (completeResult.date) {
                const nativeDate = new Date(completeResult.date);
                if (isDateValid(nativeDate)) {
                    parsedPageDate = moment(nativeDate.toISOString());
                } else {
                    parsedPageDate = chrono.parseDate(completeResult.date);
                }
            }

            // If the article date can't be found in the page, try the URL
            if (!parsedPageDate) {
                parsedPageDate = findDateInURL(request.url);
            }

            completeResult.date = parsedPageDate || null;

            console.log('Parsed date:', metadata.date);
            
            // Count the words in the article
            const wordsCount = countWords(completeResult.text);

            // Check if the article should be parsed based on the date of the article
            const isInDateRangeVar = isInDateRange(completeResult.date, parsedDateFrom);
            if (mustHaveDate && !completeResult.date) {
                console.log(`ARTICLE - ${request.userData.index} - DATE NOT IN RANGE: ${completeResult.date}`);
                return;
            }

            // Is onlyNewArticles is on, then save the article url so it is not parsed again
            if (onlyNewArticles) {
                state[completeResult.url] = true;
                await stateDataset.pushData({ url: request.url });
            }

            // compute if the article has a valid date or not
            const hasValidDate = mustHaveDate ? isInDateRangeVar : true;

            // Determine if the article is valid based on the following criteria
            const isArticle =
                hasValidDate
                && !!completeResult.title
                && wordsCount > minWords;

            // Not sure what 'Headline' means
            if (isArticle || 'Headline' in request.userData) {
                console.log(`IS VALID ARTICLE --- ${request.url}`);

                // log the date the article was parsed
                const now = new Date();
                completeResult['Date'] = (completeResult.date || completeResult['Date']) || moment(now.toISOString())

                // if classifierAPIConfig is specified and article has text, send the data to the AI Recommendation system (ML model built/hosted on Aylien)
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
                
                // if summaryAPIConfig is specified, get a summary of the article from the specified API
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

                // Store the parsed article result in Apify
                await dataset.pushData(completeResult);

                // Send the results to the bubble database as well if specified
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

                        // If the googlesheets endpoint is specified, fill out the spreadsheet with the result
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
                
                // Send the data to any specified endpoint for an undtermine next step
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

                // NUmber of articles scraped has increased by one
                articlesScraped++;

                // Stop infinite loops with a max number of articles to parse each time crawler is executed
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
