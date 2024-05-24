// const { MailtrapClient } = require("mailtrap");
import { MailtrapClient } from "mailtrap";

const TOKEN = "6ea8a4c56498dc3fff42c01a3f1de90f";
const ENDPOINT = "https://send.api.mailtrap.io/";


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
        //   attachments: [
        //     {
        //       filename: "file.txt",
        //       content: "dGVzdCBma
        //     },
        //   ],
            
        })
        // .then(console.log, console.error);
    }catch(e){
        console.log("Error occured while sending mail",e);
    }   
    
    // clientclear
    //     from: sender,
    //     to: recipients,
    //     subject: subject,
    //     text: content,
    //     category: "Integration Test",
    //   })
    //   .then(console.log, console.error);
}