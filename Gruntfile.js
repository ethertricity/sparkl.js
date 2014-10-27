'use strict';

module.exports = function (grunt) {
  require('load-grunt-tasks')(grunt);
  require('time-grunt')(grunt);

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    concat: {
      main: {
        src: ['./src/!(core).js'],
        dest: '.tmp/source.js'
      }
    },

    clean: {
      main: [
        '.tmp'
      ]
    },

    copy: {
      release: {
        cwd: '.tmp',
        src: '*',
        dest: 'build/release/',
        expand: true,
        flatten: true,
        filter: 'isFile'
      },

      core: {
        src: './src/core.js',
        dest: './.tmp/sparkl.js'
      }
    },

    replace: {
      debug: {
        options: {
          prefix: '//@@',
          patterns: [
            {
              match: 'includes',
              replacement: '<%= grunt.file.read(".tmp/source.js") %>'
            }
          ]
        },

        files: [
          {
            expand: true,
            flatten: true,
            src: ['.tmp/sparkl.js'],
            dest: 'build/debug/'
          }
        ]
      }
    },

    uglify: {
      debug: {
        files: {
          "build/debug/sparkl.min.js": ['build/debug/sparkl.js']
        }
      }
    },

    watch: {
      debug: {
        files: ['./src/*.js'],
        tasks: [
          'clean'
          , 'concat'
          , 'copy:core'
          , 'replace:debug'
          , 'clean'
        ],
        options: {
          spawn: true
        }
      }
    }
  });

  grunt.registerTask('release', []);

  grunt.registerTask('build-debug', [
    'clean'
    , 'concat'
    , 'copy:core'
    , 'replace:debug'
    , 'uglify'
    , 'clean'
  ]);

  grunt.registerTask('debug', [
    'watch:debug'
  ]);


  grunt.registerTask('test', []);
};
