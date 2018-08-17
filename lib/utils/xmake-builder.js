/*
 * This file is part of the xPack distribution
 *   (http://xpack.github.io).
 * Copyright (c) 2018 Liviu Ionescu.
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom
 * the Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */

'use strict'
/* eslint valid-jsdoc: "error" */
/* eslint max-len: [ "error", 80, { "ignoreUrls": true } ] */

// ----------------------------------------------------------------------------

const assert = require('assert')
const path = require('path')
// const fs = require('fs')

// const Promisifier = require('@ilg/es6-promisifier').Promisifier

// const CliErrorApplication =
//  require('@ilg/cli-start-options').CliErrorApplication

// const JsonCache = require('../../lib/utils/json-cache.js').JsonCache
const Util = require('./util.js').Util
const MakeGenerator = require('../generators/make.js').MakeGenerator
const SourceTree = require('./source-tree.js').SourceTree

// ----------------------------------------------------------------------------

// Promisify functions from the Node.js callbacks library.
// New functions have identical names, but placed within `promises_`.
// Promisifier.promisifyInPlace(fs, 'readFile')

// For easy migration, inspire from the Node 10 experimental API.
// Do not use `fs.promises` yet, to avoid the warning.
// const fsPromises = fs.promises_

// ============================================================================

class XmakeBuilder {
  /**
   * @summary Construct a generic builder, to be called for each
   * build configuration.
   *
   * @param {Object} context The build context.
   * @param {Object} context.log The logger.
   * @param {Object} context.cwd The absolute CWD path.
   * @param {Object} context.buildContext The build context.
   */
  constructor (context) {
    assert(context, 'There must be a context')
    this.buildContext = context

    assert(context.log, 'There must be a logger.')
    this.log = context.log

    assert(context.cwd, 'There must be a context.cwd.')
    this.cwd = context.cwd

    const log = this.log
    log.trace(`${this.constructor.name}.construct()`)

    // Instantiate the desired generator.
    if (this.buildContext.generatorName === 'make') {
      this.generator = new MakeGenerator({
        log,
        cwd: this.cwd,
        buildContext: this.buildContext
      })
    } else {
      throw new Error(`Generator '${this.buildContext.generatorName}' ` +
        'not supported.')
    }
  }

  async build (buildConfiguration) {
    const log = this.log
    log.trace(`${this.constructor.name}.build('${buildConfiguration.name}')`)

    const startTime = Date.now()

    const generatorName = this.buildContext.generatorName
    log.info()
    log.info(`Generating the '${generatorName}' files for configuration ` +
      `'${buildConfiguration.name}'...`)

    // Preferably set these before creating the source tree.
    // TODO: parametrise 'build'.
    buildConfiguration.buildAbsolutePath =
      path.join(this.cwd, 'build', buildConfiguration.name)

    buildConfiguration.buildToProjectRelativePath =
      path.relative(buildConfiguration.buildAbsolutePath, this.cwd)

    const sourceTree = new SourceTree({
      log,
      cwd: this.cwd,
      fileExtensions: buildConfiguration.toolchain.fileExtensions,
      tool: buildConfiguration.tool,
      language: buildConfiguration.language
    })

    await sourceTree.create(buildConfiguration.sourceFolders)

    buildConfiguration.sourceTree = sourceTree

    // To compute the relative paths, it needs the `buildAbsolutePath`.
    sourceTree.addRootProperties(buildConfiguration)

    // Contribute sourceFolderNodes to the build configuration.
    buildConfiguration.sourceFolderNodes = sourceTree.getSourceFolderNodes()

    await this.generator.generate(buildConfiguration)

    log.verbose()
    const durationString = Util.formatDuration(Date.now() - startTime)
    log.info(`'${generatorName}' files generated in ` +
      `${durationString}.`)

    // TODO: call the builder
  }
}

// ----------------------------------------------------------------------------
// Node.js specific export definitions.

// By default, `module.exports = {}`.
// The class is added as a property of this object.
module.exports.XmakeBuilder = XmakeBuilder

// In ES6, it would be:
// export class XmakeBuilder { ... }
// ...
// import { XmakeBuilder } from '../utils/xmake-builder.js'

// ----------------------------------------------------------------------------
