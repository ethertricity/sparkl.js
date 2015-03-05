var fs = require('fs')
  , gulp = require('gulp')
  , include = require('gulp-include')
  , rename = require('gulp-rename');

var inject = require('gulp-inject');

gulp.task("debug", function() {
  gulp.src('src/core.js')
    .pipe(include())
    .pipe(rename("sparkl.js"))
    .pipe(gulp.dest("build/debug"))
});

gulp.task("release", function() {
  gulp.src('src/core.js')
    .pipe(include())
    .pipe(rename("sparkl.js"))
    .pipe(gulp.dest("build/debug"))
});