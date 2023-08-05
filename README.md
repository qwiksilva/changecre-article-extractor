# Change CRE documentation
This repo is the Javascript code for the [Changecre Article Extractor](https://console.apify.com/actors/OLgGkLs56IQNm3wAn/source) [actor](https://docs.apify.com/academy/getting-started/actors). There is a [task](https://docs.apify.com/platform/actors/running/tasks) create dfrom this actor for each desired real estat news homepage to scrape. These tasks are run with a [schedule](https://docs.apify.com/platform/schedules) which runs everyday.

There is also a task where it's possible to input a one-off domain or article url [here](https://console.apify.com/actors/tasks/vTqRcQI6C9AmAbENS/console).

# How it works
The homepage is scraped for all links. The links are filtered if they have been processed before based on the `cnaonicalUrl`. The links are then passed through an article recognitino functino to determine if they are articles or not. The article urls are queued to be visited and processed to get the results for each article url. There are sometimes specific javascript that needs to be executed in the 'goTo' function that allows the page to be scraped properly. If the date of the article cannot be found on the page, the date that the article is scraped is used.

## Results 
There are results for each article url: 
```
Date
author
canonicalLink
date
description
domain
image
index
label
lang
loadedDomain
loadedUrl
publisher
softTitle
text
title
url
```

### Results Storage
Results from a task are stored in an Apify database, which serves as long term storage as well for checking if new articles have already been processed.

# Documentation not specific to this repo

### Smart article extractor

This actor is an extension of Apify's [Article Text Extractor](https://apify.com/mtrunkat/article-text-extractor). It has several extra features:

- Allows extraction of any number of URLs - support for Start URLs, Pseudo URLs and max crawling depth
- Smart article recognition - Actor can decide what pages on a website are in fact articles to be scraped. This is customizable.
- Additional filters - Date of articles, minimum words
- Date normalization
- Some extra data fields
- Allows custom scraping function - You can add/overwrite your own fields from the parsed HTML
- Allows using Google Bot headers (bypassing paywalls)

Example output:
- [JSON](https://api.apify.com/v2/datasets/mNg8AeuevQKjBhtTX/items?format=json&clean=1) (looks the best)
- [Table](https://api.apify.com/v2/datasets/mNg8AeuevQKjBhtTX/items?format=html&clean=1)
- [CSV](https://api.apify.com/v2/datasets/mNg8AeuevQKjBhtTX/items?format=csv&attachment=1&clean=1)

More detailed documentation to come...

### Extend output function (optional)

You can use this function to update the default output of this actor. This function gets a JQuery handle `$` as an argument so you can choose what data from the page you want to scrape. The output from this will function will get merged with the default output.

The return value of this function has to be an object!

You can return fields to achive 3 different things:
- Add a new field - Return object with a field that is not in the default output
- Change a field - Return an existing field with a new value
- Remove a field - Return an existing field with a value `undefined`


Let's say that you want to accomplish this
- Remove `links` and `videos` fields from the output
- Add a `pageTitle` field
- Change the date selector (In rare cases the scraper is not able to find it)

```javascript
($) => {
    return {
        links: undefined,
        videos: undefined,
        pageTitle: $('title').text(),
        date: $('.my-date-selector').text()
    }
}
```

