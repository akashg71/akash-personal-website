import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // quantlab is a Streamlit app on Streamlit Community Cloud. A redirect, not a rewrite: Vercel's
  // proxy cannot carry Streamlit's websocket. /quantlab/stocks opens the app's Stocks page.
  async redirects() {
    return [
      {
        source: '/quantlab/:path*',
        destination: 'https://akashestra-quantlab.streamlit.app/:path*',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
