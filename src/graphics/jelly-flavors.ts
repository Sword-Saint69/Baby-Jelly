export type JellyFlavor = {
  readonly surface:string;
  readonly absorption:readonly [number,number,number];
};

export const JELLY_FLAVORS={
  lime:{surface:'#eaffd4',absorption:[48,3.2,85]},
  strawberry:{surface:'#ffc2ce',absorption:[10,44,56]},
  blueberry:{surface:'#a9d9ff',absorption:[14,8,3]},
  lemon:{surface:'#fff06a',absorption:[8,8,112]},
  mint:{surface:'#c4ffdd',absorption:[38,6,48]},
  grape:{surface:'#dcc2ff',absorption:[22,26,6]},
  orange:{surface:'#ffd2a1',absorption:[9,32,68]},
  cola:{surface:'#f0b48c',absorption:[28,22,18]},
} as const satisfies Record<string,JellyFlavor>;

export type JellyFlavorName=keyof typeof JELLY_FLAVORS;
export const DEFAULT_JELLY_FLAVOR:JellyFlavorName='lime';
