declare module "m3u8-parser" {
  export class Parser {
    manifest: unknown;
    push(source: string): void;
    end(): void;
  }
}

declare module "mux.js" {
  const mux: {
    mp4: {
      Transmuxer: new (options: { remux: boolean }) => {
        on(
          event: "data",
          callback: (segment: {
            initSegment: Uint8Array;
            data: Uint8Array;
          }) => void,
        ): void;
        push(bytes: Uint8Array): void;
        flush(): void;
        dispose(): void;
      };
    };
  };
  export default mux;
}
