import { DEFAULT_JELLY_CHARACTER, JELLY_CHARACTERS, type JellyCharacterName } from '../graphics/character-features.ts';

const CHARACTER_ICON:Record<JellyCharacterName,string>={
  jelly:'M12 4c-3 0-5 2.2-5 5 0 3.4 2.6 7 5 7s5-3.6 5-7c0-2.8-2-5-5-5Z',
  cat:'M5 4l3 3.5c1.2-.8 2.5-1.2 4-1.2s2.8.4 4 1.2L19 4l-1 6.5c0 3.5-2.7 6.5-6 6.5s-6-3-6-6.5L5 4Z',
  bear:'M6 6a2.5 2.5 0 1 0 0 .1M18 6a2.5 2.5 0 1 0 0 .1M12 6c-3 0-5 2-5 4.8 0 3 2.2 5.7 5 5.7s5-2.7 5-5.7C17 8 15 6 12 6Z',
  bunny:'M8 3c-1 2-1 5 0 7M16 3c1 2 1 5 0 7M12 9c-2.5 0-4 1.8-4 4 0 2.6 1.8 4.5 4 4.5s4-1.9 4-4.5c0-2.2-1.5-4-4-4Z',
};

export function characterPickerMarkup() {
  const initial=getStoredCharacter();
  const options=Object.entries(JELLY_CHARACTERS).map(([name,character])=>`
    <button class="character-option" type="button" data-character="${name}" aria-pressed="${name===initial}">
      <span>${character.label}</span>
    </button>`).join('');
  return `<div id="character-picker" class="character-picker">
    <button id="character" class="icon-button character-picker-button" type="button" aria-label="Choose character (currently ${JELLY_CHARACTERS[initial].label})" aria-haspopup="true" aria-expanded="false" aria-controls="character-menu" title="Character: ${JELLY_CHARACTERS[initial].label}">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="${CHARACTER_ICON[initial]}" stroke-linejoin="round"/>
      </svg>
    </button>
    <div id="character-menu" class="character-menu" role="group" aria-label="Character choices" hidden>${options}
    </div>
  </div>`;
}

type CharacterSelectionHandler=(character:JellyCharacterName)=>void;

function isJellyCharacterName(value:string|undefined):value is JellyCharacterName {
  return value!==undefined&&Object.prototype.hasOwnProperty.call(JELLY_CHARACTERS,value);
}

const STORAGE_KEY='jelly-character';

/** The roster choice persists across reloads; switching silhouettes rebuilds
 * the soft body from the morphed cage, so selection takes effect on reload. */
export function getStoredCharacter():JellyCharacterName {
  try {
    const stored:string|undefined=localStorage.getItem(STORAGE_KEY)??undefined;
    if(isJellyCharacterName(stored))return stored;
  } catch { /* private mode: fall through to default */ }
  return DEFAULT_JELLY_CHARACTER;
}

function storeCharacter(name:JellyCharacterName) {
  try {localStorage.setItem(STORAGE_KEY,name);} catch { /* selection still applies this session */ }
}

export class CharacterPicker {
  private readonly root:HTMLDivElement;
  private readonly button:HTMLButtonElement;
  private readonly menu:HTMLDivElement;
  private readonly options:NodeListOf<HTMLButtonElement>;
  private readonly onSelect:CharacterSelectionHandler;
  private readonly abort=new AbortController();

  constructor(onSelect:CharacterSelectionHandler) {
    this.root=document.querySelector<HTMLDivElement>('#character-picker')!;
    this.button=this.root.querySelector<HTMLButtonElement>('#character')!;
    this.menu=this.root.querySelector<HTMLDivElement>('#character-menu')!;
    this.options=this.root.querySelectorAll<HTMLButtonElement>('[data-character]');
    this.onSelect=onSelect;
    const {signal}=this.abort;
    this.button.addEventListener('click',this.toggle,{signal});
    this.options.forEach(option=>option.addEventListener('click',this.choose,{signal}));
    document.addEventListener('pointerdown',this.closeWhenOutside,{signal});
    document.addEventListener('keydown',this.handleKeyDown,{signal});
    this.setSelected(getStoredCharacter());
  }

  private toggle=(event:MouseEvent)=>{
    if(this.menu.hidden)this.open(event.detail===0);
    else this.close();
  };

  private open(focusOption:boolean) {
    this.menu.hidden=false;this.button.setAttribute('aria-expanded','true');
    if(focusOption)this.options[this.selectedIndex()]?.focus({preventScroll:true});
  }

  private close=()=>{
    this.menu.hidden=true;this.button.setAttribute('aria-expanded','false');
  };

  private closeWhenOutside=(event:PointerEvent)=>{
    const target=event.target;
    if(!(target instanceof Node)||!this.root.contains(target))this.close();
  };

  private handleKeyDown=(event:KeyboardEvent)=>{
    if(event.key==='Escape'&&!this.menu.hidden) {
      event.preventDefault();this.close();this.button.focus({preventScroll:true});
    }
  };

  private selectedIndex() {
    return [...this.options].findIndex(option=>option.getAttribute('aria-pressed')==='true');
  }

  private choose=(event:MouseEvent)=>{
    const name=(event.currentTarget as HTMLButtonElement).dataset.character;
    if(!isJellyCharacterName(name))return;
    this.setSelected(name);this.close();
    (event.currentTarget as HTMLButtonElement).blur();
    this.onSelect(name);
    // Silhouette changes rebuild the cage + solver; reload into the new body.
    if(name!==getStoredCharacter()){storeCharacter(name);location.reload();}
  };

  private setSelected(name:JellyCharacterName) {
    this.button.title=`Character: ${JELLY_CHARACTERS[name].label}`;
    this.button.setAttribute('aria-label',`Choose character (currently ${JELLY_CHARACTERS[name].label})`);
    this.button.querySelector('path')?.setAttribute('d',CHARACTER_ICON[name]);
    this.options.forEach(option=>option.setAttribute('aria-pressed',String(option.dataset.character===name)));
  }

  dispose() {this.abort.abort();this.close();}
}
