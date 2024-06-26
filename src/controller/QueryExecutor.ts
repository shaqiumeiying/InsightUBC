import QueryScript from "./QueryScript";
import Sections from "./Sections";
import DataTransformer from "./DataTransformer";
import Rooms from "./Rooms";
import {
	IInsightFacade,
	InsightDataset,
	InsightDatasetKind,
	InsightResult,
	InsightError,
	NotFoundError,
	ResultTooLargeError,
} from "./IInsightFacade";

export default class QueryExecutor {
	private query: any;
	private datasets: Map<string, any[]>;
	private DataTransformer: DataTransformer = new DataTransformer();
	private NotAnykeysFields: string[];

	constructor(query: any, datasets: Map<string, any[]>) {
		this.query = query;
		this.datasets = datasets;
		this.NotAnykeysFields = ["dept", "id", "instructor", "title", "uuid", "avg", "pass", "fail", "audit", "year",
			"fullname", "shortname", "number", "name", "address", "lat", "lon", "seats", "type", "furniture", "href"];
	}

	public executeQuery(IdMain: string, WhereMain: any, OptionsMain: any, TransMain: any): Promise<InsightResult[]> {
		if (!Object.keys(this.query).includes("OPTIONS") || !Object.keys(this.query).includes("WHERE")) {
			return Promise.reject(new InsightError("no options or where"));
		}
		if (
			this.query === null ||
			this.query === undefined ||
			Object.keys(this.query).length === 0 ||
			Object.keys(this.query).length > 3 // OP, WHERE, TRANSFORMATIONS
		) {
			return Promise.reject(new InsightError("Invalid query"));
		}
		const id = IdMain;
		const where = WhereMain;
		const options = OptionsMain;
		const transformations = TransMain;
		const data = this.datasets.get(id);
		if (data === undefined) {
			return Promise.reject(new InsightError("Invalid dataset"));
		}
		let filteredData = this.executeWhere(where, data, id);
		if (transformations) {
			filteredData = this.DataTransformer.executeTransformations(transformations, filteredData, id);
		}
		const unsortedData = this.executeOptions(options, filteredData, id);
		return Promise.resolve(unsortedData);
	}

	private executeWhere(query: any, data: any, id: string): any {
		const keys = Object.keys(query);
		if (keys.length === 0) {
			return data;
		}
		const filterKey = keys[0];
		const filterValue = query[filterKey];
		switch (filterKey) {
			case "GT":
			case "LT":
			case "EQ":
				return this.executeMCOMPARISON(filterKey, filterValue, data, id);
			case "IS":
				return this.executeSCOMPARISON(filterValue, data, id);
			case "AND":
				return this.executeAND(filterValue, data, id);
			case "OR":
				return this.executeOR(filterValue, data, id);
			default:
				return this.executeNEGATION(filterValue, data, id);
		}
	}

	// Todo: this implementation is not correct, test with "" and "**" not working
	private extractFieldAndValue(filterValue: any): {field: string; value: any} {
		const key = Object.keys(filterValue)[0];
		const field = key.split("_")[1];
		const value = filterValue[key];

		return {field, value};
	}

	private executeSCOMPARISON(filterValue: any, data: any, id: string): Sections[] | Rooms[] {
		const result = this.extractFieldAndValue(filterValue);
		// Handle blank and double asterisk cases
		if (result.value === "") {
			return data.filter((section: Sections) => String(section[result.field as keyof Sections]) === "");
		} else if (result.value === "**") {
			return data; // return all data if filterValue is "**"
		}
		const regex = "^" + result.value.split("*").join(".*") + "$";
		const regExp = new RegExp(regex);
		return data.filter((section: Sections) => {
			return regExp.test(String(section[result.field as keyof Sections]));
		});
	}

	private executeMCOMPARISON(filterKey: string, filterValue: any
		, data: any, id: string): Sections[]  | Rooms[] {
		const result = this.extractFieldAndValue(filterValue);

		return data.filter((type: any) => {
			switch (filterKey) {
				case "EQ":
					return type[result.field as keyof any] === result.value;
				case "GT":
					return type[result.field as keyof any] > result.value;
				case "LT":
					return type[result.field as keyof any] < result.value;
				default:
					throw new InsightError();
			}
		});
	}

	private executeOptions(options: any, data: any, id: string): any {
		// TODO: this is not a 100% correct implementation, still not support ANYKEY in the sort yet
		let fieldsNeeded: string[] = options.COLUMNS.map((field: string) => {
			// Check if the field contains an underscore
			if (field.includes("_")) {
				// If it does, split it as before
				return field.split("_")[1];
			} else {
				// If it doesn't, return the field as is
				return field;
			}
		});
		let result: any[] = data.map((section: any) => {
			let filteredSection: any = {};
			for (let field of fieldsNeeded) {
				if (this.NotAnykeysFields.includes(field)) {
					// If the field is in the list, prepend the id and underscore
					filteredSection[id + "_" + field] = section[field as keyof Sections];
				} else {
					// If the field is not in the list (ANYKEY), use the field directly
					filteredSection[field] = section[field];
				}
			}
			return filteredSection;
		});
		if (options["ORDER"]) {
			if (typeof options["ORDER"] === "string") {
				const orderColumn = options["ORDER"];
				const [idToSort, fieldToSortBy] = orderColumn.split("_");
				result.sort((a, b) => {
					const valueA = a[orderColumn];
					const valueB = b[orderColumn];
					return valueA - valueB;
				});
			} else if (typeof options["ORDER"] === "object") {
				const orderObject = options["ORDER"];
				const direction = orderObject["dir"] === "UP" ? 1 : -1;
				const keys = orderObject["keys"];
				result.sort((a, b) => {
					for (let key of keys) {
						const [idToSort, fieldToSortBy] = key.split("_");
						const valueA = a[key];
						const valueB = b[key];
						if (valueA !== valueB) {
							return (valueA - valueB) * direction;
						}
					}
					return 0;
				});
			}
		}
		return result;
	}

	private executeAND(filterArray: any, data: any, id: string): Sections[] | Rooms[]{
		return filterArray.reduce((prevFilter: any, currentFilter: any) => {
			let keys = Object.keys(currentFilter);
			let newFilter: Set<any> = new Set(this.executeWhere({[keys[0]]: currentFilter[keys[0]]}, data, id));
			return prevFilter.filter((section: any) => newFilter.has(section));
		}, data);
	}

	private executeOR(filterArray: any, data: Sections[]| Rooms[], id: string): Sections[]| Rooms[] {
		let result: any[] = [];
		filterArray.forEach((filter: any) => {
			let keys = Object.keys(filter);
			let newFilter = this.executeWhere({[keys[0]]: filter[keys[0]]}, data, id);
			result.push(...newFilter);
		});
		return result;
	}

	private executeNEGATION(filter: any, data: any, id: string): Sections[]| Rooms[] {
		let result: any[] = this.executeWhere(filter, data, id);
		return data.filter((type: any) => !result.includes(type));
	}
}
