declare module 'alexa-verifier' {
  function verifier(
    signatureCertChainUrl: string,
    signature: string,
    body: string,
    callback: (err: Error | null) => void,
  ): void;
  export = verifier;
}
