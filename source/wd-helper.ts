import {isItemId, isPropertyId} from 'wikibase-types';
import {type WikibaseEntityReader} from 'wikidata-entity-reader';
import arrayFilterUnique from 'array-filter-unique';
import got from 'got';

const HOUR_IN_SECONDS = 60 * 60;

export const GOT_OPTIONS = {
	headers: {'user-agent': 'EdJoPaTo/wikidata-telegram-bot'},
};

let popularEntities: string[] = [];
let popularEntitiesTimestamp = 0;

export function entitiesInClaimValues(
	entity: WikibaseEntityReader | readonly WikibaseEntityReader[],
	claims: readonly string[],
) {
	const entities: readonly WikibaseEntityReader[] = Array.isArray(entity)
		? entity
		: ([entity] as WikibaseEntityReader[]);

	return claims
		.flatMap(claim => entities.flatMap(entity => entity.claim(claim)))
		.filter((o): o is string => isItemId(o) || isPropertyId(o))
		.filter(arrayFilterUnique());
}

export async function getPopularEntities() {
	const now = Date.now() / 1000;
	if (popularEntitiesTimestamp < now - HOUR_IN_SECONDS) {
		popularEntitiesTimestamp = now;

		const {body} = await got(
			'https://www.wikidata.org/w/index.php?title=Wikidata:Main_Page/Popular&action=raw',
			GOT_OPTIONS,
		);
		const regex = /(Q\d+)/g;
		// eslint-disable-next-line @typescript-eslint/ban-types
		let match: RegExpExecArray | null;
		const results: string[] = [];

		while ((match = regex.exec(body)) !== null) {
			results.push(match[1]!);
		}

		popularEntities = results;
	}

	return popularEntities;
}
