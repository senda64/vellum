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

export type AnchorFragment = {
  blockId: string;
  pageIndex: number;
  /** Top edge in preview scroll coordinates. */
  top: number;
  /** Height in preview scroll coordinates. */
  height: number;
};

export type FragmentMap = {
  blocks: AnchorBlock[];
  /** Fragments ordered by document position (top). */
  ordered: AnchorFragment[];
  /** Fragments grouped by block id, in document order. */
  byBlock: Map<string, AnchorFragment[]>;
};
