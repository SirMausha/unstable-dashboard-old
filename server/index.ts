import 'dotenv/config'
import { createApp } from './app.js'
import { createStore } from './db.js'

const host = '127.0.0.1'
const port = Number(process.env.PORT || 4174)
const store = createStore()
const server = createApp(store).listen(port, host, () => {
  console.log(`Local dashboard API listening on http://${host}:${port}`)
})

function shutdown() {
  server.close(() => {
    store.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
