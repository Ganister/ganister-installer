#!/usr/bin/env node
const { exec } = require('child_process');
const inquirer = require('inquirer');
const superagent = require('superagent');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const ora = require('ora');
const _ = require('lodash');
const updateDotenv = require('update-dotenv');

const ganisterUrl = 'https://ganister.eu/';

const agent = superagent.agent();

//  Downloaded zip file name
const zipFile = 'ganister.zip';

const start = async () => {
  const { customerEmail } = await inquirer.prompt([
    {
      type: 'input',
      message: 'Enter email',
      name: 'customerEmail',
    },
  ]);
  if (!customerEmail) return console.error('An email is required');
  let spinner = ora('Validating Email...').start();
  await agent
    .post(ganisterUrl+'ganisterInstallVerificationCode')
    .set('Content-Type', 'application/json')
    .send({ customerEmail })
    .then((res) => res.body)
    .catch((err) => err);
  spinner.succeed(`Process completed`);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `We sent you a verification code. If you didn't receive an email, please register`,
      choices: ['Enter Verification Code', 'Register'],
    },
  ]);
  if (action === 'Register') {
    const { customerName, companyName, city } = await inquirer.prompt([
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
        message: 'Enter city',
        name: 'city',
      },
    ]);
    let spinner = ora('Start Registeration process...').start();
    const registration = await agent
      .post(ganisterUrl+'ganisterinstallRegistration')
      .set('Content-Type', 'application/json')
      .send({ customerName, companyName, customerEmail, city })
      .then((res) => res.body)
      .catch((err) => {
        console.error(`Registration Failed: ${err.message}`);
        return err;
      });
    // If versions failed, show error message and exit
    if (registration instanceof Error) return spinner.fail(`Cannot Register: ${registration.message}`);
    spinner.succeed(`Registration complete`);
    const sendVerificationCode = await agent
      .post(ganisterUrl+'ganisterInstallVerificationCode')
      .set('Content-Type', 'application/json')
      .send({ customerEmail })
      .then((res) => res.body)
      .catch((err) => {
        console.error(`Verification code cannot be sent at the moment: ${err.message}`);
        return err;
      });
    if (sendVerificationCode === true) {
      console.log('Check your email for the verification code')
    }
  }
  const { verificationCode } = await inquirer.prompt([
    {
      type: 'input',
      message: 'Enter Verification Code',
      name: 'verificationCode',
    }
  ]);
  //  Get versions from ganister.eu
  const versions = await agent
    .post(ganisterUrl+'ganisterinstallReleases')
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

  //  Ganister Requires NEO4J Database. Do you want us to provide it for you for 15 days?
  const { createDB } = await inquirer.prompt([
    {
      type: 'list',
      name: 'createDB',
      message: `Ganister Requires NEO4J Database. Do you want us to provide it for you, for the next 15 days?`,
      choices: ['Yes', 'No'],
    },
  ]);

  let awsRegion, boltURL, password, username;
  if (createDB === 'Yes') {
    const { region } = await inquirer.prompt([
      {
        type: 'list',
        name: 'region',
        message: `Please select a db region`,
        choices: ['Europe', 'US'],
      },
    ]);

    //  Send Create DB Call
    spinner = ora('Creating DB...').start();
    const newDB = await agent
      .post(ganisterUrl+'ganisterinstallDB')
      .set('Content-Type', 'application/json')
      .send({ customerEmail, verificationCode, region })
      .then((res) => res.body)
      .catch((err) => {
        console.error(`Looks like the provided email and verification code are not yet verified in our system: ${err.message}`);
        return err;
      });
    // If failed, show error message and exit
    if (newDB instanceof Error) return (`Cannot create DB: ${newDB.message}`);
    spinner.succeed('Database Created');
    awsRegion = newDB.awsRegion;
    boltURL = newDB.boltURL;
    password = newDB.password;
    username = newDB.username;
  }

  const targetVersion = versions.find((v) => v.version === version);
  //  Start Spinner
  spinner = ora('Start installing Ganister...').start();

  //  Download Zip File
  agent
    .post(ganisterUrl+`ganisterinstallDownload${targetVersion.url}`)
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
      if (createDB === 'Yes') {
        console.log(`
        Your database has been created!
        BoltURL: ${boltURL}
        Username: ${username}
        Password: ${password}
        Aws Region: ${awsRegion},
        `);
        const params = {};
        if (boltURL) params.DB_BOLTURL = boltURL;
        if (username) params.DB_USERNAME = username;
        if (password) params.DB_PASSWORD = password;
        updateDotenv(params).then((newEnv) => {
          spinner = ora('Installing packages (npm install)...').start();
          exec('npm install', (error, stdout, stderr) => {
            if (error) {
              spinner.fail(`Install Packages Error: ${error}. Please run "npm install" and "npm dbInit" manually.`);
              return;
            }
            spinner.succeed('Packages Installed');
            if (boltURL && username && password) {
              spinner = ora('Initializing Database (npm run dbInit)...').start();
              exec('npm run dbInit', (error, stdout, stderr) => {
                if (error) {
                  spinner.fail(`DB Init Error: ${error}. Please run "npm run dbInit" manually.`);
                  return;
                }
                spinner.succeed('Database Initialized');
                console.log(`You can now login with username: "test@ganister.eu" and password: "ganister"`);
                console.log('Run "npm run dev" command in your project folder to start the app');
              });
            } else {
              console.log('Run "npm run dbInit" after you update the db username and password in your .env file');
              console.log('If you need to reset your database credentials, do not hesitate to contact us directly.');
            }
          });
        });
      }
    });
};

start();