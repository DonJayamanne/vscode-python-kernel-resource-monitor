module.exports = [
    require('./scripts/webpack.extension')(__dirname, 'node'),
    {
        ...require('./scripts/webpack.client')(__dirname),
        entry: `./src/realtime/client.ts`
    }
];
