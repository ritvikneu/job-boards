import { app } from './app/app.js';

const port = 7777;

app.listen(port,() => console.log(`Server is listening at ${port}`));
