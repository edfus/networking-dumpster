const dgram = require('dgram');
const server = (
  dgram.createSocket('udp4') // ipv4
    .on('message', async (localReq, linfo) => {
      console.log(localReq);
    })
    .on('listening', () => {
      const address = server.address();
      console.log(`server listening ${address.address}:${address.port}`);
    })
    .on('error', (err) => {
      console.log(`server error:\n${err.stack}`);
      server.close();
    })
);

server.bind(53, 'localhost');
