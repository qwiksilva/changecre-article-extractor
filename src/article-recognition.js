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

    return false;
};

module.exports.isInDateRange = (publicationDateISO, dateFrom) => {
    if (!dateFrom) {
        return true;
    }
    const publicationDate = moment(publicationDateISO);
    return publicationDate > dateFrom;
};
