export type AnchorBlock = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
};

export type AnchorMap = {
  blocks: AnchorBlock[];
  html: string;
};

export type LogicalPosition = {
  blockId: string;
  relativePosition: number;
};
