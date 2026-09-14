declare module "pagedjs" {
  export class Previewer {
    polisher: {
      destroy(): void;
    };
    chunker: {
      pages: Array<{
        removeListeners?: () => void;
      }>;
    };
    preview(
      content: HTMLElement | DocumentFragment | string,
      stylesheets: Array<string | Record<string, string>>,
      renderTo: HTMLElement,
    ): Promise<{ total: number }>;
  }
}
