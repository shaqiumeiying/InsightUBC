import MComparison from "./MComparison";

export default class QueryScript {
	private id: Set<string>;
	private where: any;
	private options: any;

	constructor(query: any) {
		let whereIds = this.parseID(query["WHERE"]);
		let optionIds = this.parseID(query["OPTIONS"], whereIds);
		this.id = new Set([...whereIds, ...optionIds]);
		this.where = query["WHERE"];
		this.options = query["OPTIONS"];
	}

	// This helper function will help parse the ID from the query object, in this case, the WHERE or OPTIONS object
	private parseIDFromObject(query: any, key: string, existingIds: Set<string>, ids: Set<string>): Set<string> {
		let newIds = this.parseID(query[key], new Set([...existingIds, ...ids]));
		for (let id of newIds) {
			ids.add(id);
		}
		return ids;
	}

	// This helper function will help parse the ID from the query object, in this case,the COLUMN object
	private parseIDFromArray(query: any, key: string, existingIds: Set<string>, ids: Set<string>): Set<string> {
		for (let item of query[key]) {
			if (typeof item === "string" && item.includes("_")) {
				let id = item.split("_")[0];
				if (!ids.has(id) && !existingIds.has(id)) {
					ids.add(id);
				}
			}
			if (typeof item === "object" && item !== null) {
				let newIds = this.parseID(item, new Set([...existingIds, ...ids]));
				for (let id of newIds) {
					ids.add(id);
				}
			}
		}
		return ids;
	}

	// This helper function will help parse the ID from the query object, in this case, the ORDER.
	private parseIDFromKey(key: string, existingIds: Set<string>, ids: Set<string>): Set<string> {
		if (key.includes("_")) {
			let id = key.split("_")[0];
			if (!ids.has(id) && !existingIds.has(id)) {
				ids.add(id);
			}
		}
		return ids;
	}

	/**
	 * Parses the query object and extracts the IDs.
	 *
	 * @param query - The query object to parse.
	 * @param existingIds - An array of existing IDs to exclude from the result.
	 * @returns A Set of extracted IDs.
	 */
	private parseID(query: any, existingIds: Set<string> = new Set()): Set<string> {
		let ids: Set<string> = new Set();
		for (let key in query) {
			if (Array.isArray(query[key])) {
				ids = this.parseIDFromArray(query, key, existingIds, ids);
			} else if (typeof query[key] === "object" && query[key] !== null) {
				ids = this.parseIDFromObject(query, key, existingIds, ids);
			} else {
				ids = this.parseIDFromKey(key, existingIds, ids);
			}
		}
		return ids;
	}

	public getID(): Set<string> {
		return this.id;
	}

	public getWhere(): any {
		return this.where;
	}

	public getOptions(): any {
		return this.options;
	}

	public ValidateQuery(): boolean {
		if (typeof this.where !== "object" || typeof this.options !== "object") {
			return false;
		} // If WHERE or OPTIONS is not an object, return false
		if (Object.keys(this.options).length === 0) {
			return false;
		} // If WHERE or OPTIONS is empty, return false
		if (Object.keys(this.where).length > 1 || Object.keys(this.options).length > 2) {
			return false;
		} // If WHERE has more than one key or OPTIONS has more than two keys, return false
		if (!this.validateWhere(this.where)) {
			return false;
		}
		if (!this.validateOptions(this.options)) {
			return false;
		}
		return true;
	}

	public validateWhere(where: any): boolean {
		if (Object.keys(where).length === 0) {
			return true;
		}
		const key = Object.keys(where)[0];
		if (key === "AND" || key === "OR") {
			// If the key is "AND" or "OR", the value should be an array of sub-conditions
			if (!Array.isArray(where[key]) || where[key].length === 0) {
				return false;
			}
			// Recursively validate each sub-condition
			for (let subCondition of where[key]) {
				if (!this.validateWhere(subCondition)) {
					return false;
				}
			}
		} else if (key === "NOT") {
			if (
				typeof where[key] !== "object" ||
				!this.validateWhere(where[key]) ||
				Object.keys(where[key]).length === 0
			) {
				console.log(where[key].length);
				return false;
			}
		} else if (key === "LT" || key === "GT" || key === "EQ") {
			return this.validateMComparison(where);
		} else if (key === "IS") {
			return this.validateSComparison(where);
		} else {
			// other keys are invalid
			return false;
		}
		return true;
	}

	public validateMComparison(mComparison: any): boolean {
		// Check if mComparison is an object with exactly one property
		if (typeof mComparison !== "object" || Object.keys(mComparison).length !== 1) {
			return false;
		}
		// Extract the key and value from the mComparison object
		const key = mComparison[Object.keys(mComparison)[0]];
		if (Object.keys(key).length !== 1) {
			return false;
		}
		const object = Object.keys(key)[0];
		const field = object.split("_")[1];
		const number = key[object];
		// Check if the key is a valid field and the value is a number
		if (!this.isValidMField(field) || typeof number !== "number") {
			return false;
		}

		return true;
	}

	private isValidMField(field: string): boolean {
		// This is a placeholder. Replace this with your actual implementation.
		const validFields = ["avg", "pass", "fail", "audit", "year"];
		return validFields.includes(field);
	}

	public validateSComparison(sComparison: any): boolean {
		// Check if sComparison is an object with exactly one property
		if (typeof sComparison !== "object" || Object.keys(sComparison).length !== 1) {
			return false;
		}
		// Extract the key and value from the mComparison object
		const key = sComparison[Object.keys(sComparison)[0]];
		if (Object.keys(key).length !== 1) {
			return false;
		}
		const object = Object.keys(key)[0];
		const field = object.split("_")[1];
		const string = key[object];
		if (!this.isValidSField(field) || typeof string !== "string") {
			return false;
		}
		// This line of code for regex is referenced from:
		// https://stackoverflow.com/questions/10868308/regular-expression-a-za-z0-9
		// Updated regex to allow for blank strings and strings with only asterisks
		const regex = /^(\*)?[a-zA-Z0-9]*(\*)?$/;
		if (!regex.test(string)) {
			return false;
		}
		// Check if the string value contains at most two '*'
		// This line of code for counting asterisks is referenced from:
		// https://stackoverflow.com/questions/881085/count-the-number-of-asterisks-in-a-string
		const asteriskCount = (string.match(/\*/g) || []).length;
		if (asteriskCount > 2) {
			return false;
		}

		return true;
	}

	private isValidSField(field: string): boolean {
		const validFields = ["dept", "id", "instructor", "title", "uuid"];
		return validFields.includes(field);
	}

	public validateOptions(options: any): boolean {
		if (typeof options !== "object" || !Object.keys(options).includes("COLUMNS")) {
			return false;
		}
		// find columns for checking order
		const columns = options["COLUMNS"];
		if (!this.validateColumns(columns)) {
			return false;
		}
		if (Object.keys(options).includes("ORDER") && !this.validateOrder(options["ORDER"], columns)) {
			return false;
		}
		return true;
	}

	private validateColumns(columns: any): boolean {
		// Check if columns is an array of strings
		if (columns.length === 0 || !Array.isArray(columns) || !columns.every((item) => typeof item === "string")) {
			return false;
		}

		// Check each column
		for (let column of columns) {
			let parts = column.split("_");
			if (parts.length !== 2) {
				return false;
			}

			let id = parts[0];
			let field = parts[1];
			if (!this.isValidField(field)) {
				return false;
			}
		}

		return true;
	}

	private validateOrder(order: any, columns: string[]): boolean {
		// Check if order is a string
		if (typeof order !== "string") {
			return false;
		}

		let parts = order.split("_");
		if (parts.length !== 2) {
			return false;
		}

		let id = parts[0];
		let field = parts[1];
		if (!this.isValidField(field)) {
			return false;
		}

		// Check if the field is in the COLUMNS array
		if (!columns.includes(order)) {
			return false;
		}

		return true;
	}

	private isValidField(field: string): boolean {
		const validFields = ["avg", "pass", "fail", "audit", "year", "dept", "id", "instructor", "title", "uuid"];
		return validFields.includes(field);
	}
}
