// const { MailtrapClient } = require("mailtrap");
import { MailtrapClient } from "mailtrap";
import { readFileSync } from "fs";
import path from "path";

const TOKEN = "6ea8a4c56498dc3fff42c01a3f1de90f";
const ENDPOINT = "https://send.api.mailtrap.io/";


const filePath = "/Users/ritvikparamkusham/Downloads/Projects/job-boards/app/data/Jobs_May23.xlsx";
const fileName = "Jobs_May23.xlsx";

export const sendMailAttachment = (subject, content) => {
  const client = new MailtrapClient({ endpoint: ENDPOINT, token: TOKEN });

  const sender = {
    email: "mailtrap@demomailtrap.com",
    name: "Mailtrap Test",
  };

  const recipients = [
    {
      email: "ritvik.param@gmail.com",
    }
  ];

  const fileContent = readFileSync(filePath);
  const attachment = {
    filename: fileName,
    content: fileContent.toString("base64"),
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    disposition: "attachment"
  };

  try {
    client
      .send({
        from: sender,
        to: recipients,
        subject: subject,
        text: content,
        category: "Integration Test",
        attachments: [attachment]
      })
      .then(response => {
        console.log("Email sent successfully:", response);
      })
      .catch(error => {
        console.error("Error occurred while sending email:", error);
      });
  } catch (e) {
    console.log("Error occurred while sending mail", e);
  }
};

// sendMailAttachment("Jobs_May23", "---------- Please find the attached Excel file with the job listings ----------");


export const sendMail = (subject,content) => {
    const client = new MailtrapClient({ endpoint: ENDPOINT, token: TOKEN });

    const sender = {
      email: "mailtrap@demomailtrap.com",
      name: "Mailtrap Test",
    };
    const recipients = [
      {
        email: "ritvik.param@gmail.com",
      }
    ];
    try {
        client
        .send({
          from: sender,
          to: recipients,
          subject: subject,
          text: content,
          category: "Integration Test",
        })
    }catch(e){
        console.log("Error occured while sending mail",e);
    }   
  
}