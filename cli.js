#!/usr/bin/env node

const inquirer = require('inquirer');
const superagent = require('superagent');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const ora = require('ora');
const _ = require('lodash');

const agent = superagent.agent();

//  Downloaded zip file name
const zipFile = 'ganister.zip';

const start = async () => {
  const { username, password } = await inquirer.prompt([
    {
      type: 'input',
      message: 'Enter username',
      name: 'username',
    },
    {
      type: 'password',
      message: 'Enter password',
      name: 'password',
    },
  ]);
  //  Get versions from ganister.eu
  const versions = await agent
    .post('https://ganister.eu/securePortal/ganisterReleases')
    .set('Content-Type', 'application/json')
    .send({ username, password })
    .then((res) => res.body)
    .catch((err) => {
      console.error(`Cannot Login to Ganister: ${err.message}`);
      return err;
    });
  // If versions failed, show error message and exit
  if (versions instanceof Error) return (`Cannot get versions list: ${versions.message}`);
  //  Filter versions
  const validVersions = versions.filter((v) => v.published && v.url).map((v) => v.version);
  if (!validVersions) return console.error('No versions found!');

  const { version } = await inquirer.prompt([
    {
      type: 'list',
      name: 'version',
      message: 'Select version',
      choices: validVersions,
    },
  ]);
  const { confirm } = await inquirer.prompt([
    {
      type: 'list',
      name: 'confirm',
      message: `Version ${version} would be installed. Continue?`,
      choices: ['Yes', 'No, Exit'],
    },
  ]);

  if (confirm !== 'Yes') return 0;

  const targetVersion = versions.find((v) => v.version === version);
  //  Start Spinner
  let spinner = ora('Start installing Ganister...').start();

  //  Download Zip File
  agent
    .get(`https://ganister.eu${targetVersion.url}`)
    .set('Accept-Encoding', 'gzip, deflate, br')
    .on('error', (err) => {
      spinner.fail(`Ganister Download Failed! Read error below: ${err.message}`);
      return err;
    })
    .pipe(fs.createWriteStream(zipFile))
    .on('finish', async () => {
      try {
        spinner.succeed('File downloaded!');
        spinner = ora('Unzipping file...').start();
        const zip = new AdmZip(zipFile);
        zip.extractAllTo('./', true);
        spinner.succeed('File Unzipped!');
        await fs.removeSync(zipFile);
      } catch (err) {
        spinner.fail(`Zip extract failed: ${err}`);
        return 0;
      }
      console.log(`
        ----------------------------------------------------------------------------
        |                                                                          |
        |      ██████╗  █████╗ ███╗   ██╗██╗███████╗████████╗███████╗██████╗       |
        |     ██╔════╝ ██╔══██╗████╗  ██║██║██╔════╝╚══██╔══╝██╔════╝██╔══██╗      |
        |     ██║  ███╗███████║██╔██╗ ██║██║███████╗   ██║   █████╗  ██████╔╝      |
        |     ██║   ██║██╔══██║██║╚██╗██║██║╚════██║   ██║   ██╔══╝  ██╔══██╗      |
        |     ╚██████╔╝██║  ██║██║ ╚████║██║███████║   ██║   ███████╗██║  ██║      |
        |      ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝      |
        |                                                                          |
        ----------------------------------------------------------------------------\n
        \x1b[32m                Version ${targetVersion.version} has been installed!\x1b[0m \n
        ----------------------------------------------------------------------------\n`);
    });
};

start();