const { createApp } = require("./app");
const i = process.argv.indexOf("--port");
const port = Number(i >= 0 ? process.argv[i+1] : process.env.PORT || 3000);
createApp().listen(port, "0.0.0.0", () => console.log(`ThaiGame.org listening on ${port}`));
