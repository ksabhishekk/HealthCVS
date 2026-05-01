const fetch = require('node-fetch')
const FormData = require('form-data')

const uploadToPinata = async (buffer, fileName, mimeType) => {
  const form = new FormData()
  form.append('file', buffer, { filename: fileName, contentType: mimeType })
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }))
  form.append('pinataMetadata', JSON.stringify({ name: fileName }))

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PINATA_JWT}`,
      ...form.getHeaders(),
    },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Pinata upload failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return data.IpfsHash
}

const ipfsGatewayUrl = (cid) => {
  const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
  return `https://${gateway}/ipfs/${cid}`
}

module.exports = { uploadToPinata, ipfsGatewayUrl }
