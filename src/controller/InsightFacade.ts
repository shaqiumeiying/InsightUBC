import {
	IInsightFacade,
	InsightDataset,
	InsightDatasetKind,
	InsightResult,
	InsightError,
	NotFoundError,
	ResultTooLargeError,
} from "./IInsightFacade";
import DatasetProcessor from "./DatasetProcessor";
import * as fs from "fs-extra";
import Sections from "./Sections";
import QueryScript from "./QueryScript";
import QueryExecutor from "./QueryExecutor";
import Rooms from "./Rooms";
import RoomProcessor from "./RoomProcessor";

/**
 * This is the main programmatic entry point for the project.
 * Method documentation is in IInsightFacade
 *
 */
export default class InsightFacade implements IInsightFacade {
	private datasets: Map<string, Sections[] | Rooms[]>;
	private isDataBeenLoadedIndicator: boolean;

	constructor() {
		// keep track of valid datasets
		this.datasets = new Map<string, Sections[] | Rooms[]>();
		this.isDataBeenLoadedIndicator = false;
	}

	private async checkIfDataHasBeenLoaded() {
		if (!this.isDataBeenLoadedIndicator) {
			try {
				await this.loadData();
				this.isDataBeenLoadedIndicator = true;
			} catch (error) {
				return new InsightError("Failed to load data");
			}
		} else {
			return;
		}
	}

	public async addDataset(id: string, content: string, kind: InsightDatasetKind): Promise<string[]> {
		return this.checkIfDataHasBeenLoaded().then(() => {
			const dp = new DatasetProcessor();
			const rp = new RoomProcessor();
			if (id === null || id === "" || id.trim().length === 0 || id.includes("_")) {
				return Promise.reject(new InsightError("id is null or empty"));
			}
			if (this.datasets.has(id)) {
				return Promise.reject(new InsightError("id already exists"));
			}
			if (kind === InsightDatasetKind.Sections) {
				return dp.validateSections(id, content).then((result) => {
					this.datasets.set(id, result);
					let list: string[] = Array.from(this.datasets.keys());
					return Promise.resolve(list);
				});
			} else if (kind === InsightDatasetKind.Rooms) {
				return rp.validateRooms(id, content).then((result) => {
					this.datasets.set(id, result);
					let list: string[] = Array.from(this.datasets.keys());
					return Promise.resolve(list);
				});
			} else {
				return Promise.reject(new InsightError("Invalid kind"));
			}
		});
	}

	public async removeDataset(id: string): Promise<string> {
		return this.checkIfDataHasBeenLoaded().then(async () => {
			if (id === null || id === "" || id.trim().length === 0 || id.includes("_")) {
				return Promise.reject(new InsightError("id is null or empty"));
			}
			if (!this.datasets.has(id)) {
				return Promise.reject(new NotFoundError("id does not exist"));
			}
			let path = "data/" + id + ".json";
			try {
				await fs.promises.unlink(path);
			} catch {
				return Promise.reject(new InsightError("Failed to remove dataset: "));
			}
			this.datasets.delete(id);
			return Promise.resolve(id);
		});
	}

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		try {
			await this.checkIfDataHasBeenLoaded();
			let parsedQuery = JSON.parse(JSON.stringify(query));
			const queryScript = new QueryScript(query);
			const where = queryScript.getWhere();
			const options = queryScript.getOptions();
			const transformations = queryScript.getTransformations();
			const ids = queryScript.getID();
			const id = ids.values().next().value;
			if (!queryScript.ValidateQuery()) {
				return Promise.reject(new InsightError("Invalid query"));
			}
			if (ids.size !== 1 || !this.datasets.has(id)) {
				return Promise.reject(new InsightError("Invalid dataset"));
			}
			let result = new QueryExecutor(parsedQuery, this.datasets);
			let r = await result.executeQuery(id, where, options, transformations);
			// Convert Sections objects to InsightResult objects
			if (r.length >= 5000) {
				return Promise.reject(new ResultTooLargeError());
			}
			return Promise.resolve(r);
		} catch (error) {
			return Promise.reject(new InsightError());
		}
	}

	public async listDatasets(): Promise<InsightDataset[]> {
		return this.checkIfDataHasBeenLoaded().then(() => {
			let result: InsightDataset[] = [];
			this.datasets.forEach((value: Sections[] | Rooms[], key) => {
				const element = value[0];
				if (this.isSectionsObject(element)) {
					let info: InsightDataset = {
						id: key,
						kind: InsightDatasetKind.Sections,
						numRows: value.length,
					};
					result.push(info);
				} else {
					let info: InsightDataset = {
						id: key,
						kind: InsightDatasetKind.Rooms,
						numRows: value.length,
					};
					result.push(info);
				}
			});
			return Promise.resolve(result);
		});
	}

	public static async writeFile(id: string, content: any): Promise<any> {
		let path = "data/" + id + ".json";
		// let data = JSON.stringify(content);
		return new Promise((resolve, reject) => {
			fs.outputJSON(path, content, (err) => {
				if (err) {
					reject(err);
				}
				resolve("Successfully wrote the file to the disk");
			});
		});
	}


	// public static async writeFile(id: string, content: any): Promise<any> {
	// 	const dir = "data";
	// 	const path = `${dir}/${id}.json`;
	// 	const data = JSON.stringify(content);
	//
	// 	// Ensure the directory exists
	// 	await fs.ensureDir(dir);
	//
	// 	// Write the file
	// 	await fs.promises.writeFile(path, data);
	//
	// 	return "Successfully wrote the file to the disk";
	// }

	public async loadData(): Promise<any> {
		let path = "data/";
		await fs.ensureDir("data/");
		try {
			const files = await fs.promises.readdir(path);
			await Promise.all(
				files.map(async (file) => {
					const filePath = path + file;
					const data = await fs.promises.readFile(filePath, "utf8");
					const jsonData = JSON.parse(data);
					const id = file.slice(0, -5);
					this.datasets.set(id, jsonData);
				})
			);
			return this.datasets;
		} catch (error) {
			console.warn((error as Error).message);
			console.warn((error as Error).stack);
		}
	}

	private isSectionsObject(obj: any): boolean {
		return "title" in obj && "uuid" in obj && "instructor" in obj && "dept" in obj && "year" in obj &&
			"avg" in obj && "id" in obj && "pass" in obj && "fail" in obj && "audit" in obj;
	}
}
