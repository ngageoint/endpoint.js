// This file is needed because browserify will only include files
// that it needs to run its test.  So any files that aren't directly
// required won't be included in coverage reports.  This file
// will recursively include all javascript files in the js/app and
// js/plugins folders.
// This uses the require-globify plugin / transform for browserify.
var files = require('../app/*.js', { mode: 'expand' });
