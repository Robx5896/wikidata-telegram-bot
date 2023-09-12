import {arrayFilterUnique} from 'array-filter-unique';
import {type EntityId, isEntityId, type PropertyId, type SearchResult, simplifySparqlResults, type SnakValue, type SparqlResults, type SparqlValueType} from 'wikibase-sdk';
import {wdk} from 'wikibase-sdk/wikidata.org';
import type {WikibaseEntityReader} from 'telegraf-wikibase';
import historyDB, {History, HistoryPaths, SparQLQueries} from './database.js';
import { Context } from './bot-generics.js';
import { format } from './format/index.js';

historyDB

type Wbk = typeof wdk;

const HOUR_IN_SECONDS = 60 * 60;

const USER_AGENT = 'github.com/EdJoPaTo/wikidata-telegram-bot';
const FETCH_HEADERS = new Headers();
FETCH_HEADERS.set('user-agent', USER_AGENT);
const FETCH_OPTIONS = {headers: FETCH_HEADERS};

let popularEntities: string[] = [];
let popularEntitiesTimestamp = 0;

export function entitiesInClaimValues(
	entities: readonly WikibaseEntityReader[],
	claims: readonly PropertyId[],
) {
	return claims
		.flatMap(claim => entities.flatMap(entity => entity.claimValues(claim)))
		.flatMap(value => entitiesInSnakValue(value))
		.filter(arrayFilterUnique());
}

function entitiesInSnakValue(claim: SnakValue): EntityId[] {
	if (claim.type === 'wikibase-entityid') {
		return [claim.value.id];
	}

	if (claim.type === 'quantity') {
		const entity = /Q\d+$/.exec(claim.value.unit)?.[0];
		if (entity && isEntityId(entity)) {
			return [entity];
		}
	}

	return [];
}

export async function getHistoryEntities(
		user_id: number,
		type: string
	): Promise<readonly string[]> {

	const historyRepository = historyDB.getRepository(History);
	const history = historyRepository.createQueryBuilder("history")
		.select("history.entity", "entity")
		.where("history.user_id = :user_id AND history.type = :type", { user_id: user_id, type: type })
		.orderBy("id", "ASC")
		.getRawMany();

	if ((await history).length < 1) {
		return [];
	}

	const entities: string[] = (await history).map((entry) => entry.entity);

	return entities;
}

export async function addHistoryEntity(
		user_id: number,
		entity: string,
		type: string
	) : Promise<void> {

		const historyRepository = historyDB.getRepository(History)
		const existingEntity = await historyRepository.findOne({
			where: {
				user_id: user_id,
				entity: entity
			}
		});
    
    	if (!existingEntity) {
			// the logic of this process is reversed, so just think Tenet
			const lastIdQueryResult = await historyRepository
				.createQueryBuilder("history")
				.select("MIN(history.id)", "lastId")
				.where("history.user_id = :id AND history.type = :type", { id: user_id, type: type })
				.getRawOne();

			let lastId = lastIdQueryResult.lastId ? lastIdQueryResult.lastId : 6; // default if there are no ids

			const newEntity = new History();
			newEntity.user_id = user_id;
			newEntity.entity = entity;
			newEntity.type = type;
			newEntity.id = lastId - 1; // calculate the new id
			await historyRepository.insert(newEntity);

			if(lastId == 1) {
				
				// delete the first search, so we got only 5 items in the history
				await historyRepository
					.createQueryBuilder()
					.delete()
					.from(History)
					.where("user_id = :id AND type = :type", { id: user_id, type: type })
					.where("id = :id", {id: 5})
					.execute();
				
				// so update all the ids for put new ones without make anything explode
				await historyRepository
					.createQueryBuilder()
					.update(History)
					.set({ id: () => "id + 1" })
					.where("user_id = :id AND type = :type", { id: user_id, type: type })
					.execute();
			}
		}
	}

export async function getHistoryEntitiesPaths(
	user_id: number
): Promise<readonly string[]> {

	const historyRepository = historyDB.getRepository(HistoryPaths);

	const history = historyRepository.createQueryBuilder("historypaths");
	const historyPaths = history
		.select("historypaths.path", "path")
		.where("historypaths.user_id = :user_id", { user_id: user_id })
		.getRawMany();

	if ((await historyPaths).length < 1) {
		return [];
	}

	const entities: string[] = (await historyPaths)[0].path.split(" ");

	return entities;
}

export async function addHistoryEntityPath(
	user_id: number,
	path: string
  ): Promise<void> {
	const historyRepository = historyDB.getRepository(HistoryPaths);
	const existingEntity = await historyRepository.findOne({
		where: {
			user_id: user_id,
		},
	});
  
	if (existingEntity) {
		const entities = existingEntity.path.split(" ");
		const newPathPart = path.split(" ")[0] as string;
		const filteredEntities = entities.filter((entity) => entity !== newPathPart);
		filteredEntities.unshift(newPathPart);

		if (filteredEntities.length > 5) {
			filteredEntities.pop();
		}
	
		existingEntity.path = filteredEntities.join(" ");
		await historyRepository.save(existingEntity);
		return;
	}
	const newEntity = new HistoryPaths();
	newEntity.user_id = user_id;
	newEntity.path = path;
	await historyRepository.insert(newEntity);
  }
  
export async function clearHistoryPaths(
	user_id: number
  ): Promise<void> {
	const historyRepository = historyDB.getRepository(HistoryPaths);
	await historyRepository
		.createQueryBuilder()
		.delete()
		.from(HistoryPaths)
		.where("user_id = :user_id", { user_id: user_id })
		.execute();
}

export async function initializeSparQLQuery(
	user_id: number
) : Promise<void> {

	const sparqlRepository = historyDB.getRepository(SparQLQueries)
	const existingInstance = await sparqlRepository.findOne({
		where: {
			user_id: user_id,
		}
	});

	if(!existingInstance){
		const newQuery = new SparQLQueries();
		newQuery.user_id = user_id;
		newQuery.subject = "";
		newQuery.predicate = "";
		newQuery.object = "";
		newQuery.status = 0;
		await sparqlRepository.insert(newQuery);
	} else {
		await sparqlRepository.delete({user_id: user_id});
		const newQuery = new SparQLQueries();
		newQuery.user_id = user_id;
		newQuery.subject = "";
		newQuery.predicate = "";
		newQuery.object = "";
		newQuery.status = 0;
		await sparqlRepository.insert(newQuery);
	}
}

export async function updateSparQLQuery(
	user_id: number,
	subject: string,
	predicate: string,
	object: string,
	status: number
) : Promise<void> {

	const sparqlRepository = historyDB.getRepository(SparQLQueries)
	const existingInstance = await sparqlRepository.findOne({
		where: {
			user_id: user_id,
		}
	});

	if(existingInstance){
		existingInstance.subject = subject;
		existingInstance.predicate = predicate;
		existingInstance.object = object;
		existingInstance.status = status;
		await sparqlRepository.save(existingInstance);
	}
}

export async function getSparQLQuery(
	user_id: number
) : Promise<SparQLQueries> {

	const sparqlRepository = historyDB.getRepository(SparQLQueries)
	const existingInstance = await sparqlRepository.findOne({
		where: {
			user_id: user_id,
		}
	});

	if(existingInstance){
		return existingInstance;
	} else {
		const newQuery = new SparQLQueries();
		newQuery.user_id = user_id;
		return newQuery;
	}
}

export async function buildSparQLQuery(
	user_id: number
) : Promise<string> {

	const sparqlRepository = historyDB.getRepository(SparQLQueries)
	const existingInstance = await sparqlRepository.findOne({
		where: {
			user_id: user_id,
		}
	});

	if(existingInstance){
		const subject = existingInstance.subject;
		const predicate = await getPropertyFromLabel(existingInstance.predicate);
		const object = await getEntityIdFromLabel(existingInstance.object);
		return `SELECT DISTINCT ?${subject} ?${subject}Label WHERE {
			?persona wdt:${predicate} wd:${object}
			SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en" }
		  }
		  LIMIT 100`;
	} else {
		return `SELECT DISTINCT ?persona ?personaLabel WHERE {
			?persona wdt:P40 wd:Q40026
			SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en" }
		  }
		  LIMIT 100`;
	}
}

interface Predicate {
	value: string;
	label: string;
	// Add other properties as needed
  }
  
interface Result {
	[x: string]: any;
	predicate: Predicate;
  }
  
  export function queryJsonEntryToResult(entry: any): Result {
	for (const key in entry) {
		if (entry[key] && entry[key].value && entry[key].label) {
		  const predicateValue = entry[key];
	
		  return {
			predicate: {
			  value: predicateValue.value || '',
			  label: predicateValue.label || '',
			},
			// Add other properties based on your data structure
		  };
		}
	  }
	return {
		predicate: {
		  value: '',
		  label: '',
		},
		// Add other properties based on your data structure
	  };
  }
  
export async function createResultsString(
	ctx: Context,
	results: readonly Result[],
	pageZeroBased: number
  ): Promise<string> {
	const ENTRIES_PER_PAGE = 10; // Define your entries per page.
  
	const relevant = [...results]
	  .slice(
		pageZeroBased * ENTRIES_PER_PAGE,
		(pageZeroBased + 1) * ENTRIES_PER_PAGE
	  );
  
	const parts = await Promise.all(relevant.map(async (o) => entryString(ctx, o)));
	const text = parts.join('\n\n');
	return text;
  }
  
async function entryString(ctx: Context, result: Result): Promise<string> {
	const reader = await ctx.wd.reader(result.predicate.value);
  
	let text = '';
  
	text += format.bold(format.escape(reader.label()));
	text += '  ';
	text += '/' + reader.qNumber();
  
	const entityDescription = reader.description();
	if (entityDescription) {
	  text += '\n';
	  text += '  ';
	  text += format.escape(entityDescription);
	}
  
	return text;
  }  

export async function querySparql(
	query: string
) : Promise<Result[]> {
	const raw = await sparqlQuerySimplified(query);
	if (raw[0]) {
		const result = raw.map(o => queryJsonEntryToResult(o));
		return result;
	} else {
		return [];
	}
}

export async function getEntityIdFromLabel(
	label: string
) : Promise<string> {

	const url = wdk.searchEntities({
		search: label
	});
	const response = await fetch(url, FETCH_OPTIONS);
	const body = await response.json() as {search: SearchResult[]};
	return body.search[0]?.id as string;

}

export async function getPropertyFromLabel(
	label: string
) : Promise<string> {

	const url = wdk.searchEntities({
		search: label,
		type: 'property'
	});
	const response = await fetch(url, FETCH_OPTIONS);
	const body = await response.json() as {search: SearchResult[]};
	return body.search[0]?.id as string;

}

export async function getPopularEntities() {
	const now = Date.now() / 1000;
	if (popularEntitiesTimestamp < now - HOUR_IN_SECONDS) {
		popularEntitiesTimestamp = now;

		const headers = new Headers();
		headers.set('user-agent', USER_AGENT);

		const response = await fetch(
			'https://www.wikidata.org/w/index.php?title=Wikidata:Main_Page/Popular&action=raw',
			{
				headers,
			},
		);
		const body = await response.text();

		const regex = /Q\d+/g;
		// eslint-disable-next-line @typescript-eslint/ban-types
		let match: RegExpExecArray | null;
		const results: string[] = [];

		while ((match = regex.exec(body)) !== null) {
			results.push(match[0]!);
		}

		popularEntities = results;
	}

	return popularEntities;
}

type SearchEntitiesOptions = Parameters<Wbk['searchEntities']>[0];
export async function searchEntities(options: SearchEntitiesOptions) {
	const url = wdk.searchEntities(options);
	const response = await fetch(url, FETCH_OPTIONS);
	const body = await response.json() as {search: SearchResult[]};
	return body.search;
}

export async function sparqlQuerySimplified(
	query: string,
): Promise<ReadonlyArray<Record<string, SparqlValueType>>> {
	const url = wdk.sparqlQuery(query);
	const response = await fetch(url, FETCH_OPTIONS);
	try {
		const body = await response.json() as SparqlResults;
		const simplified = simplifySparqlResults(body) as ReadonlyArray<Record<string, SparqlValueType>>;
		return simplified;
	} catch (error) {
		console.error('Error parsing SPARQL response', error);
		return response as unknown as ReadonlyArray<Record<string, SparqlValueType>>;
	}
}
