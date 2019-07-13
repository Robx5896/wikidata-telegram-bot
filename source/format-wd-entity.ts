import {getSitelinkData, getImageUrl} from 'wikidata-sdk';
import {Markup, UrlButton} from 'telegraf';
import WikidataEntityReader from 'wikidata-entity-reader';
import WikidataEntityStore from 'wikidata-entity-store';

import {secureIsEntityId} from './wd-helper';
import * as format from './format';

export function entityWithClaimText(store: WikidataEntityStore, entityId: string, claimIds: string[], language = 'en'): string {
	const entity = new WikidataEntityReader(store.entity(entityId), language);

	let text = '';
	text += headerText(entity);
	text += '\n\n';

	const claimTextEntries = claimIds
		.map(o => claimText(store, entity, o, language));

	text += claimTextEntries
		.filter(o => o)
		.join('\n\n');

	return text;
}

function headerText(entity: WikidataEntityReader): string {
	let text = '';
	text += format.bold(entity.label());
	text += ' ';
	text += format.italic(entity.qNumber());

	const description = entity.description();
	if (description) {
		text += '\n';
		text += format.escapedText(description);
	}

	const aliases = entity.aliases();
	if (aliases.length > 0) {
		text += '\n\n';
		text += format.array('Alias', aliases.map(o => format.escapedText(o)));
	}

	return text;
}

export function entityButtons(store: WikidataEntityStore, entityId: string, language: string): UrlButton[] {
	const entity = new WikidataEntityReader(store.entity(entityId), language);
	const buttons: UrlButton[] = [
		Markup.urlButton(
			new WikidataEntityReader(store.entity('buttons.wikidata'), language).label(),
			entity.url()
		)
	];

	const sitelinkButtons: UrlButton[] = entity.allSitelinksInLang()
		.map(o => Markup.urlButton(
			getSitelinkData(o).project,
			entity.sitelinkUrl(o)!
		));

	return [
		...buttons,
		...sitelinkButtons,
		...claimUrlButtons(store, entity, 'buttons.website', language, url => url),
		...claimUrlButtons(store, entity, 'buttons.github', language, part => `https://github.com/${part}`),
		...claimUrlButtons(store, entity, 'buttons.googlePlayStore', language, part => `https://play.google.com/store/apps/details?id=${part}`),
		...claimUrlButtons(store, entity, 'buttons.imdb', language, part => `https://www.imdb.com/title/${part}/`),
		...claimUrlButtons(store, entity, 'buttons.itunes', language, part => `https://itunes.apple.com/app/id${part}/`),
		...claimUrlButtons(store, entity, 'buttons.sourceCodeRepo', language, url => url),
		...claimUrlButtons(store, entity, 'buttons.steam', language, part => `https://store.steampowered.com/app/${part}/`),
		...claimUrlButtons(store, entity, 'buttons.subreddit', language, part => `https://www.reddit.com/r/${part}/`),
		...claimUrlButtons(store, entity, 'buttons.telegram', language, part => `https://t.me/${part}`),
		...claimUrlButtons(store, entity, 'buttons.twitter', language, part => `https://twitter.com/${part}`),
		...claimUrlButtons(store, entity, 'buttons.twitterHashtag', language, part => `https://twitter.com/hashtag/${part}?f=tweets`)
	];
}

function claimUrlButtons(store: WikidataEntityStore, entity: WikidataEntityReader, storeKey: string, language: string, urlModifier: (part: string) => string): UrlButton[] {
	const property = new WikidataEntityReader(store.entity(storeKey), language);
	const claimValues = entity.claim(property.qNumber());

	const buttons = claimValues.map(o =>
		Markup.urlButton(
			`${property.label()}${claimValues.length > 1 ? ` ${o}` : ''}`,
			urlModifier(o)
		)
	);

	return buttons;
}

function claimText(store: WikidataEntityStore, entity: WikidataEntityReader, claim: string, language: string): string {
	const claimLabel = new WikidataEntityReader(store.entity(claim), language).label();
	const claimValues = entity.claim(claim);

	const claimValueTexts = claimValues
		.map(o => claimValueText(store, o, language));

	return format.array(claimLabel, claimValueTexts);
}

function claimValueText(store: WikidataEntityStore, value: any, language: string): string {
	if (secureIsEntityId(value)) {
		const id = value as string;
		const reader = new WikidataEntityReader(store.entity(id), language);
		return format.url(reader.label(), reader.url());
	}

	return format.escapedText(String(value));
}

export function image(entity: WikidataEntityReader): {photo?: string; thumb?: string} {
	const possible = [
		...entity.claim('P18'), // Image
		...entity.claim('P154'), // Logo image
		...entity.claim('P5555'), // Schematic illustation
		...entity.claim('P117') // Chemical structure
	]
		.filter(o => typeof o === 'string') as string[];

	if (possible.length === 0) {
		return {};
	}

	const selected = possible[0];

	return {
		photo: encodeURI(getImageUrl(selected, 800)),
		thumb: encodeURI(getImageUrl(selected, 100))
	};
}
