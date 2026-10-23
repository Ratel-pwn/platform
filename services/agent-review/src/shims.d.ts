declare module 'pdf-parse' {
  interface PdfData { text: string }
  const parse: (data: Buffer) => Promise<PdfData>
  export default parse
}
