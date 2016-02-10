module.exports = {
    reports: {
        options: {
            mode: 0700,
            create: ['reports', 'reports/errorShots', 'reports/wdio']
        }
    },
    unit: {
        options: {
            mode: 0700,
            create: ['reports', 'reports/coverage']
        }
    }
};
