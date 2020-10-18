const moment = require('moment');

const { findDateInURL } = require('./utils');

module.exports.countWords = (text) => {
    if (typeof text !== 'string') return false;
    return text.split(' ').length;
};

module.exports.isUrlArticle = (url, isUrlArticleDefinition) => {
    if (!isUrlArticleDefinition) {
        return true;
    }
    const matches = isUrlArticleDefinition.linkIncludes || [];
    for (const string of matches) {
        if (url.toLowerCase().includes(string)) {
            return true;
        }
    }
    const excludes = isUrlArticleDefinition.mustNotInclude || [];
    for (const string of excludes) {
        if (url.toLowerCase().includes(string)) {
            return false;
        }
    }
    if (isUrlArticleDefinition.hasDate) {
        const foundDate = findDateInURL(url);
        if (foundDate) {
            return true;
        }
    }

    if (isUrlArticleDefinition.minDashes) {
        const dashes = url.split('').reduce((acc, char) => char === '-' ? acc + 1 : acc, 0);
        if (dashes >= isUrlArticleDefinition.minDashes) {
            return true;
        }   
    }
    return false;
};

module.exports.isInDateRange = (publicationDateISO, dateFrom) => {
    const publicationDate = moment(publicationDateISO);
    const currentDate = moment();
    if (publicationDate > currentDate) {
        return false
    }

    if (!dateFrom) {
        return true;
    }
    
    return publicationDate > dateFrom;
};
