import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@airgap/beacon-sdk')) return 'beacon'
          if (id.includes('@polkadot/')) return 'polkadot'
          if (id.includes('@tonconnect/')) return 'tonconnect'
          if (id.includes('sats-connect')) return 'sats-connect'
        },
      },
    },
  },
})
