/*
 * This file is part of the xPack distribution
 *   (http://xpack.github.io).
 * Copyright (c) 2017 Liviu Ionescu.
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

/**
 * The `xmake test <options> ...` command implementation.
 */

// ----------------------------------------------------------------------------

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const spawn = require('child_process').spawn
const util = require('util')

const Promisifier = require('@ilg/es6-promisifier').Promisifier

// ES6: `import { CliCommand, CliExitCodes, CliError } from 'cli-start-options'
const CliCommand = require('@ilg/cli-start-options').CliCommand
const CliOptions = require('@ilg/cli-start-options').CliOptions
const CliHelp = require('@ilg/cli-start-options').CliHelp
const CliExitCodes = require('@ilg/cli-start-options').CliExitCodes
const CliApplication = require('@ilg/cli-start-options').CliApplication
const CliError = require('@ilg/cli-start-options').CliError
const CliErrorApplication =
  require('@ilg/cli-start-options').CliErrorApplication

const MakeGenerator = require('../../lib/generators/make.js').MakeGenerator
const SourceTree = require('../../lib/utils/source-tree.js').SourceTree
const BuildArtefact =
  require('../../lib/utils/build-configuration.js').BuildArtefact
const XmakeParser = require('../../lib/utils/xmake-parser.js').XmakeParser

// ----------------------------------------------------------------------------

// Promisify functions from the Node.js callbacks library.
// New functions have similar names, but suffixed with `Promise`.
Promisifier.promisifyInPlace(fs, 'readFile')
Promisifier.promisifyInPlace(fs, 'stat')
Promisifier.promisifyInPlace(fs, 'readdir')
// Promisifier.promisifyInPlace(fs, 'mkdir')
// Promisifier.promisifyInPlace(fs, 'writeFile')

// const mkdirpPromise = Promisifier.promisify(require('mkdirp'))

// For easy migration, inspire from the Node 10 experimental API.
const fsPromises = fs.promises_

// ----------------------------------------------------------------------------

const defaultDepth = 2
const xmakeJsonFileName = 'xmake.json'
const buildFolderName = 'build'

// ============================================================================

class Test extends CliCommand {
  // --------------------------------------------------------------------------

  /**
   * @summary Constructor, to set help definitions.
   *
   * @param {Object} context Reference to a context.
   */
  constructor (context) {
    super(context)

    // Title displayed with the help message.
    this.title = 'Build and run project test(s)'
    this.optionGroups = [
      {
        title: 'Test options',
        preOptions: '[<path>...]', // Array of folder paths.
        postOptions: '[-- <build args> [-- <run args>]]', // Extra arguments.
        optionDefs: [
          {
            options: ['--config'],
            param: 'name',
            msg: 'Configuration name',
            init: (context) => {
              context.config.configNames = []
            },
            action: (context, val) => {
              context.config.configNames.push(val.toLowerCase())
              context.config.hasFilters = true
            },
            isOptional: true,
            isMultiple: true
          },
          {
            options: ['--target'],
            param: 'name',
            msg: 'Target name',
            init: (context) => {
              context.config.targetNames = []
            },
            action: (context, val) => {
              context.config.targetNames.push(val.toLowerCase())
              context.config.hasFilters = true
            },
            isOptional: true,
            isMultiple: true
          },
          {
            options: ['--toolchain'],
            param: 'name',
            msg: 'Toolchain name',
            init: (context) => {
              context.config.toolchainNames = []
            },
            action: (context, val) => {
              context.config.toolchainNames.push(val.toLowerCase())
              context.config.hasFilters = true
            },
            isOptional: true,
            isMultiple: true
          },
          {
            options: ['--profile'],
            param: 'name',
            msg: 'Profile name',
            init: (context) => {
              context.config.profileNames = []
            },
            action: (context, val) => {
              context.config.profileNames.push(val.toLowerCase())
              context.config.hasFilters = true
            },
            isOptional: true,
            isMultiple: true
          },
          {
            options: ['--depth'],
            param: 'n',
            msg: `Search depth, default ${defaultDepth}`,
            init: (context) => {
              context.config.searchDepth = defaultDepth
            },
            action: (context, val) => {
              context.config.searchDepth = val
            },
            isOptional: true
          },
          {
            options: ['--build-folder'],
            param: 'path',
            msg: `Build folder, default ${buildFolderName}`,
            init: (context) => {
              context.config.buildFolderPath = buildFolderName
            },
            action: (context, val) => {
              context.config.buildFolderPath = val
            },
            isOptional: true
          }
        ]
      }
    ]
  }

  doOutputHelpArgsDetails (more) {
    const log = this.context.log
    if (!more.isFirstPass) {
      log.always('where:')
      log.always(`${CliHelp.padRight('  <name>...', more.width)} ` +
        `Folder path(s) (optional, multiple)`)
      log.always(`${CliHelp.padRight('  <build args>...', more.width)} ` +
        `Extra arguments for the builder (optional, multiple)`)
      log.always(`${CliHelp.padRight('  <run args>...', more.width)} ` +
        `Extra arguments when running the test (optional, multiple)`)
    }
  }

  /**
   * @summary Execute the `test` command.
   *
   * @async
   * @param {string[]} args Command line arguments.
   * @returns {number} Return code.
   *
   * @override
   */
  async doRun (args) {
    const log = this.log
    log.trace(`${this.constructor.name}.doRun()`)
    const context = this.context
    const config = context.config

    log.info(this.title)
    const paths = CliOptions.filterOwnArguments(args)
    const otherArgs = CliOptions.filterOtherArguments(args)
    this.builderArgs = CliOptions.filterOwnArguments(otherArgs)
    this.runnerArgs = CliOptions.filterOtherArguments(otherArgs)

    // Validate --depth.
    if (config.searchDepth) {
      if (isNaN(config.searchDepth)) {
        log.error(`Invalid value (${config.searchDepth}) ` +
          `for '--depth', must be a number.`)
        return CliExitCodes.ERROR.APPLICATION
      }
    }

    try {
      // If the application is an xPack, read its package.json.
      context.appPackJson = await CliApplication.readPackageJson(config.cwd)
    } catch (err) {
      context.appPackJson = {}
    }

    if (paths.length === 0) {
      // If no folders given, try to use `directories.test`, if available.
      if (context.appPackJson.directories &&
        context.appPackJson.directories.test) {
        log.trace(`Using package '${context.appPackJson.directories.test}'` +
          ` folder.`)
        paths.push(context.appPackJson.directories.test)
      } else {
        paths.push('test')
      }
    }

    // Identify tests in the given folders.
    const testFolders = await this.identifyTests(paths)
    for (const folder of testFolders) {
      log.debug(`testFolder: '${folder}'`)
    }

    if (testFolders.length) {
      // Perform identified tests, one at a time.
      for (const folder of testFolders) {
        await this.performTestConfigurations(folder)
      }
    } else {
      log.warn('No tests identified.')
    }

    this.outputDoneDuration()
    return CliExitCodes.SUCCESS
  }

  /**
   * @summary Identify tests in an array of paths.
   *
   * @async
   * @param {string[]} paths Array of relative paths.
   * @returns {string[]} Array of paths with xmake.json files.
   */
  async identifyTests (paths) {
    const log = this.log
    const config = this.context.config

    const testFoldersAbsolutePaths = []
    for (const path_ of paths) {
      let p
      if (path.isAbsolute(path_)) {
        p = path_
      } else {
        p = path.resolve(config.cwd, path_)
      }
      log.trace(`inFolder: ' ${p}'`)
      await this.identifyTestFoldersRecursive(p, config.searchDepth,
        testFoldersAbsolutePaths)
    }
    return testFoldersAbsolutePaths
  }

  /**
   * @summary Identify folders containing an xmake.json file.
   *
   * @async
   * @param {string} folderAbsolutePath Folder to search for.
   * @param {number} depth How deep the search can go.
   * @param {string[]} outArray Output array of string absolute paths.
   * @returns {undefined} Nothing.
   *
   * @description
   * The file is checked only if present, the content is not yet
   * validated.
   * Folders starting with a dot cannot be used as test folders,
   * they are usually used for metadata and are skipped.
   */
  async identifyTestFoldersRecursive (folderAbsolutePath, depth, outArray) {
    let folderStat
    try {
      folderStat = await fsPromises.stat(folderAbsolutePath)
    } catch (err) {
      return
    }
    if (!folderStat.isDirectory()) {
      return
    }

    const jsonAbsolutePath = path.resolve(folderAbsolutePath, xmakeJsonFileName)
    try {
      const fileStat = await fsPromises.stat(jsonAbsolutePath)
      if (fileStat.isFile()) {
        outArray.push(folderAbsolutePath)
        return
      }
    } catch (err) {
      // Probably ENOENT if the file was not found.
    }

    if (depth === 0) {
      return
    }

    // No more excuses; recurse on all subfolders.
    const names = await fsPromises.readdir(folderAbsolutePath)
    for (let name of names) {
      if (name.startsWith('.')) {
        // Skip folders that start with a dot.
        continue
      }
      const childAbsolutePath = path.resolve(folderAbsolutePath, name)
      await this.identifyTestFoldersRecursive(childAbsolutePath, depth - 1,
        outArray)
    }
  }

  /**
   * @summary Build and run one or more test configurations.
   *
   * @param {string} folderPath Absolute folder path.
   * @returns {undefined} Nothing.
   */
  async performTestConfigurations (folderPath) {
    const log = this.log
    const context = this.context
    const config = context.config

    // Instantiate parser for each test.
    const xmakeParser = new XmakeParser(context)

    const jsonPath = path.resolve(folderPath, xmakeJsonFileName)
    log.debug(jsonPath)

    this.testContext = await xmakeParser.parse(jsonPath)

    // Iterate over the configurations array.
    for (const configuration of this.testContext.configurations) {
      let mustTest = true
      // If no filters are used, perform all tests.
      if (config.hasFilters) {
        // Otherwise test only those that match at least one filter.
        mustTest = false
        if (config.configNames) {
          for (const configName of config.configNames) {
            if (configName === configuration.name) {
              mustTest = true
              break
            }
          }
        }
        if (config.targetNames) {
          for (const targetName of config.targetNames) {
            if (targetName === configuration.target.name) {
              mustTest = true
              break
            }
          }
        }
        if (config.toolchainNames) {
          for (const toolchainName of config.toolchainNames) {
            if (toolchainName === configuration.toolchain.name) {
              mustTest = true
              break
            }
          }
        }
        if (config.profileNames) {
          for (const profileName of config.profileNames) {
            for (const configProfile of config.profiles) {
              if (profileName === configProfile.name) {
                mustTest = true
                break
              }
            }
          }
        }
      }
      if (mustTest) {
        await this.performTestConfiguration(configuration)
      }
    }
  }

  async performTestConfiguration (configuration) {

  }

  // --------------------------------------------------------------------------
  // DEPRECATED!

  /**
   * @summary Run a test for all its profiles.
   *
   * @param {string} folderPath Absolute folder path.
   * @returns {undefined} Nothing.
   */
  async runTest (folderPath) {
    const log = this.log
    const context = this.context
    const config = context.config

    const jsonPath = path.resolve(folderPath, xmakeJsonFileName)
    const fileContent = await fs.readFilePromise(jsonPath)
    assert(fileContent !== null)
    const testJson = JSON.parse(fileContent.toString())
    this.testJson = testJson

    if (testJson.generator) {
      if (testJson.generator === 'make') {
        this.generator = new MakeGenerator(context)
      } else {
        throw new CliErrorApplication(
          `Unsupported generator '${testJson.generator}'.`)
      }
    }

    let profiles = ['default']
    let testName = path.basename(folderPath).toLowerCase()
    if (testJson.version === '0.1.0') {
      if (testJson.name) {
        testName = testJson.name.toLowerCase()
      }
      if (testJson.profiles) {
        profiles = Object.keys(testJson.profiles)
      }
    }
    profiles.forEach((profile, index, array) => {
      array[index] = profile.toLowerCase()
      log.debug('profile: ' + array[index])
    })

    let targets
    if (config.targetNames.length !== 0) {
      targets = config.targetNames
    } else {
      targets = ['darwin'] // TODO: get a default
    }

    let toolchains
    if (config.toolchainNames.length !== 0) {
      toolchains = config.toolchainNames
    } else {
      toolchains = ['gcc'] // TODO: get a default
    }

    const cwdLength = config.cwd.length + 1

    assert(testJson.sourceFolders, 'sourceFolders')
    const testRelativeSourceFolders = testJson.sourceFolders
    const topSourceFolders = []
    testRelativeSourceFolders.forEach((folder) => {
      const absPath = path.resolve(folderPath, folder)
      topSourceFolders.push(absPath.slice(cwdLength))
    })

    assert(testJson.includeFolders, 'includeFolders')
    const testRelativeIncludeFolders = testJson.includeFolders
    const includeFolders = []
    testRelativeIncludeFolders.forEach((folder) => {
      const absPath = path.resolve(folderPath, folder)
      includeFolders.push(absPath.slice(cwdLength))
    })

    const sourceTree = new SourceTree(context)
    await sourceTree.create(topSourceFolders)

    const sourceFolderNodes = []
    const sourceFolders = []
    sourceTree.getSourceFolders(sourceFolderNodes)
    for (const node of sourceFolderNodes) {
      log.debug(`source folders: ${node.relativePath}`)
      sourceFolders.push(node.relativePath)
    }

    this.testContext = {}
    this.testContext.json = testJson
    this.testContext.topSourceFolders = topSourceFolders
    this.testContext.sourceFolders = sourceFolders
    this.testContext.sourceFolderNodes = sourceFolderNodes
    this.testContext.includeFolders = includeFolders
    this.testContext.isVerbose = log.isVerbose()

    for (let target of targets) {
      for (let toolchain of toolchains) {
        for (let profile of profiles) {
          await this.runProfile(testName, target, toolchain, profile)
        }
      }
    }
  }

  /**
   * @summary Build and run a test.
   *
   * @param {string} testName Test name.
   * @param {string} targetName Target name.
   * @param {string} toolchainName Toolchain name.
   * @param {string} profileName Profile name.
   *
   * @returns {undefined} Nothing
   */
  async runProfile (testName, targetName, toolchainName, profileName) {
    const log = this.log
    const context = this.context
    const config = context.config
    const testContext = this.testContext

    log.info()
    log.info(`Starting test '${testName}', target '${targetName}', ` +
      `toolchain '${toolchainName}', profile '${profileName}'...`)

    const profileContext = {}
    this.profileContext = profileContext

    profileContext.testName = testName
    profileContext.target = targetName
    profileContext.toolchain = toolchainName
    profileContext.profile = profileName

    profileContext.tools = {}
    profileContext.options = {}

    if (path.isAbsolute(config.buildFolderPath)) {
      config.buildRelativePath =
        path.relative(config.buildFolderPath, config.cwd)
    } else {
      config.buildRelativePath = config.buildFolderPath
    }
    const profileBuildRelativePath = path.join(config.buildRelativePath,
      `test-${testName}-${targetName}-${toolchainName}-${profileName}`)
    const profileBuildAbsolutePath =
      path.resolve(config.cwd, profileBuildRelativePath)
    profileContext.profileToCwdRelativePath =
      path.relative(profileBuildAbsolutePath, config.cwd)

    profileContext.profileBuildRelativePath = profileBuildRelativePath
    profileContext.profileBuildAbsolutePath = profileBuildAbsolutePath

    let profileArtifact = {}
    if (this.testJson.profiles && this.testJson.profiles[profileName] &&
      this.testJson.profiles[profileName].artefact) {
      profileArtifact = this.testJson.profiles[profileName].artefact
    }
    let testArtifact = {}
    if (this.testJson.artefact) {
      testArtifact = this.testJson.artefact
    }

    let configArtifact = {}
    configArtifact.type = profileArtifact.type || testArtifact.type ||
      'executable'
    configArtifact.name = profileArtifact.name || testArtifact.name || testName
    configArtifact.outputPrefix = profileArtifact.outputPrefix ||
      testArtifact.outputPrefix || ''
    configArtifact.outputSuffix = profileArtifact.outputSuffix ||
      testArtifact.outputSuffix || ''

    if (configArtifact.name.includes('${test.name}')) { // eslint-disable-line no-template-curly-in-string, max-len
      configArtifact.name = configArtifact.name.replace('${test.name}', // eslint-disable-line no-template-curly-in-string, max-len
        testName)
    }
    profileContext.artefact = new BuildArtefact(configArtifact)
    log.trace(util.inspect(profileContext.artefact))

    log.verbose()
    let srcStr = ''
    testContext.sourceFolders.forEach((folder) => {
      if (srcStr) {
        srcStr += ', '
      }
      srcStr += `'${folder}'`
    })

    log.verbose(`Source folders: ${srcStr}`)

    let incStr = ''
    let includeOptions = ''
    testContext.includeFolders.forEach((folder) => {
      if (incStr) {
        incStr += ', '
        includeOptions += ' '
      }
      incStr += `'${folder}'`
      includeOptions +=
        `-I"${profileContext.profileToCwdRelativePath}/${folder}"`
    })

    log.verbose(`Include folders: ${incStr}`)
    profileContext.includeOptions = includeOptions

    const json = testContext.json

    let cTool = json.toolchains[toolchainName].c
    cTool += ' ' + json.profiles[profileName].toolchains[toolchainName].common
    cTool += ' ' + json.profiles[profileName].toolchains[toolchainName].c
    log.verbose('Tool C: ' + cTool)
    profileContext.tools.c = json.toolchains[toolchainName].c
    profileContext.options.c =
      json.profiles[profileName].toolchains[toolchainName].common + ' ' +
      json.profiles[profileName].toolchains[toolchainName].c

    let cppTool = json.toolchains[toolchainName].cpp
    cppTool += ' ' + json.profiles[profileName].toolchains[toolchainName].common
    cppTool += ' ' + json.profiles[profileName].toolchains[toolchainName].cpp
    log.verbose('Tool C++: ' + cppTool)
    profileContext.tools.cpp = json.toolchains[toolchainName].cpp
    profileContext.options.cpp =
      json.profiles[profileName].toolchains[toolchainName].common + ' ' +
      json.profiles[profileName].toolchains[toolchainName].cpp

    // Generate files specific to the generator.
    await this.generator.generate(testContext, profileContext)

    if (json.commands && json.commands.build) {
      log.verbose()
      log.info(`Changing current folder to ` +
        `'${profileContext.relativeBuildPath}'...`)
      // TODO: minimise noise when -q (quiet) or -s (silent).
      const spawnPromise = (command, args = [], options = {}) => {
        return new Promise((resolve, reject) => {
          options.stdio = 'inherit'
          const child = spawn(command, args, options)

          child.on('error', (err) => {
            reject(err)
          })
          child.on('close', (code) => {
            resolve(code)
          })
        })
      }

      log.info()
      log.info(`Invoking builder: '${json.commands.build}'...`)
      const builder = Array.isArray(json.commands.build)
        ? json.commands.build : json.commands.build.split(' ')
      const builderCmd = builder[0]
      const builderArgs = builder.slice(1).concat(this.builderArgs)
      log.debug(`spawn: ${builderCmd} ${builderArgs.join(' ')}`)
      const code = await spawnPromise(builderCmd, builderArgs, {
        cwd: profileContext.absoluteBuildPath
      })
      if (code !== 0) {
        throw new CliError(`Failed, '${json.commands.build}' ` +
          `returned ${code}.`, CliExitCodes.ERROR.CHILD)
      }

      log.info()
      log.info(`Invoking artefact: '${profileContext.artefact.fullName}'...`)
      if (json.commands.run) {
        const runner = Array.isArray(json.commands.run)
          ? json.commands.run : json.commands.run.split(' ')
        if (runner[0].includes('${artefact.fullName}')) { // eslint-disable-line no-template-curly-in-string, max-len
          runner[0] = runner[0].replace('${artefact.fullName}', // eslint-disable-line no-template-curly-in-string, max-len
            profileContext.artefact.fullName)
        }

        const runnerCmd = runner[0]
        const runnerArgs = runner.slice(1).concat(this.runnerArgs)
        log.debug(`spawn: ${runnerCmd} ${runnerArgs.join(' ')}`)
        const code = await spawnPromise(runnerCmd, runnerArgs, {
          cwd: profileContext.absoluteBuildPath
        })
        if (code !== 0) {
          throw new CliError(`Failed, '${json.commands.run}' ` +
            `returned ${code}.`, CliExitCodes.ERROR.CHILD)
        }

        log.info()
        log.info(`Test '${testName}', target '${targetName}', toolchain ` +
          `'${toolchainName}', profile '${profileName}' completed successfuly.`)
      }
    } else {
      log.warn('Builder not defined.')
    }
  }

  // --------------------------------------------------------------------------
}

// ----------------------------------------------------------------------------
// Node.js specific export definitions.

// By default, `module.exports = {}`.
// The Test class is added as a property of this object.
module.exports.Test = Test

// In ES6, it would be:
// export class Test { ... }
// ...
// import { Test } from 'test.js'

// ----------------------------------------------------------------------------
