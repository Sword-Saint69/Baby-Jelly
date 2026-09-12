import { execFileSync } from 'node:child_process';

// Share the production compiler flags with the native equivalence regression.
export function compileKernel(output,defines=[]) {
  const args=[process.env.CLANG||'clang',
    '--target=wasm32','-O3','-fno-builtin','-nostdlib',
    '-Wl,--no-entry','-Wl,--export-memory',
    '-Wl,--initial-memory=16777216','-Wl,--max-memory=16777216',
    ...defines.map(name=>`-D${name}`),'scripts/native/soft-body-kernel.c','-o',output,
  ];
  const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
  execFileSync('zsh',['-ic',args.map(quote).join(' ')],{stdio:'inherit'});
}
