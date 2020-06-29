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
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'A user account is required to download Ganister. Please select:',
      choices: ['Register', 'Download'],
    },
  ]);
  if (action === 'Register') {
    const { customerName, companyName, customerEmail, city } = await inquirer.prompt([
      {
        type: 'input',
        message: 'Enter name',
        name: 'customerName',
      },
      {
        type: 'input',
        message: 'Enter company name',
        name: 'companyName',
      },
      {
        type: 'input',
        message: 'Enter email',
        name: 'customerEmail',
      },
      {
        type: 'input',
        message: 'Enter city',
        name: 'city',
      },
    ]);
    let spinner = ora('Start Registeration process...').start();
    const registration = await agent
      .post('https://ganister.eu/ganisterinstallRegistration')
      .set('Content-Type', 'application/json')
      .send({ customerName, companyName, customerEmail, city })
      .then((res) => res.body)
      .catch((err) => {
        console.error(`Registration Failed: ${err.message}`);
        return err;
      });
    // If versions failed, show error message and exit
    if (registration instanceof Error) return spinner.fail(`Cannot Register: ${registration.message}`);
    spinner.succeed(`Registration complete. Please confirm your email before downloading Ganister`);
  }
  if (action === 'Download') {
    const { customerEmail, verificationCode } = await inquirer.prompt([
      {
        type: 'input',
        message: 'Enter email',
        name: 'customerEmail',
      },
      {
        type: 'input',
        message: 'Enter Verification Code',
        name: 'verificationCode',
      }
    ]);
    //  Get versions from ganister.eu
    const versions = await agent
      .post('https://ganister.eu/ganisterinstallReleases')
      .set('Content-Type', 'application/json')
      .send({ customerEmail, verificationCode })
      .then((res) => res.body)
      .catch((err) => {
        console.error(`Looks like the provided email and verification code are not yet verified in our system: ${err.message}`);
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
      .post(`https://ganister.eu/ganisterinstallDownload${targetVersion.url}`)
      .set('Accept-Encoding', 'gzip, deflate, br')
      .send({ customerEmail, verificationCode })
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
          spinner.fail(`Zip extract failed: ${err.message}`);
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
  }
};

start();