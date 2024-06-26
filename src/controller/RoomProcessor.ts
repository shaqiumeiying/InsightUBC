import Rooms from "./Rooms";
import JSZip from "jszip";
import {InsightError} from "./IInsightFacade";
import InsightFacade from "./InsightFacade";
import * as parse5 from "parse5";
import BuildingsAndRoomsParser from "./BuildingsAndRoomsParser";

export default class RoomProcessor {
	public static BldgFields: string[] = ["views-field views-field-field-building-code",
		"views-field views-field-title", "views-field views-field-field-building-address"];

	public static RoomFields: string[] = ["views-field views-field-field-room-number",
		"views-field views-field-field-room-capacity", "views-field views-field-field-room-furniture",
		"views-field views-field-field-room-type"];

	public validBldgTable: any[] = [];
	public validRoomTable: any[] = [];
	private path: string = "";
	public async validateRooms(id: string, content: string): Promise<Rooms[]> {
		const brp = new BuildingsAndRoomsParser();
		try {
			const zip = new JSZip();
			const rawFile = await zip.loadAsync(content, {base64: true});

			// 1: Find Index.htm
			const indexHtmlContent = await this.findIndexHtml(rawFile);

			// 2: Validate Index.htm
			if (this.validateIndexHTML(indexHtmlContent)) {
				// 3: Extract valid building HTMLs
				const buildingHtmls = await this.extractValidBuildingHtmls(this.validBldgTable, rawFile);

				// 4: Extract rooms from valid building HTMLs
				this.validRoomTable = await this.extractRoomsFromBuildingHtmls(rawFile, buildingHtmls);
				if (this.validBldgTable.length === 0 || this.validRoomTable.length === 0) {
					return Promise.reject(new InsightError("No valid building or room table found"));
				}

				// 6: Store valid rooms in the dataset
				const roomJSON = await brp.makeRooms(this.validBldgTable, this.validRoomTable);
				// start pushing fragments of data into rooms datatype
				await InsightFacade.writeFile(id, roomJSON);
				return Promise.resolve(roomJSON);
			} else {
				return Promise.reject(new InsightError("Invalid index HTML"));
			}
		} catch (err) {
			return Promise.reject(new InsightError("Error processing dataset"));
		}
	}

	private async findIndexHtml(rawFile: JSZip): Promise<string> {
		const indexHtmlFile = rawFile.file("index.htm");
		if (!indexHtmlFile) {
			throw new InsightError("Index.htm not found");
		}
		return await indexHtmlFile.async("text");
	}

	private validateIndexHTML(indexHtmlContent: string) {
		const document = parse5.parse(indexHtmlContent);
		const buildingTable = this.findTableWithCells(document,RoomProcessor.BldgFields);
		return !!buildingTable;
	}

	private findTableWithCells(node: any, requiredClasses: string[]): any | null {
		if (node.childNodes && node.childNodes.length > 0) {
			for (const childNode of node.childNodes) {
				if (childNode.nodeName === "tbody" && this.hasRequiredClass(childNode, "tr", requiredClasses, 3)) {
					return this.validBldgTable = this.getTableContent(childNode);
				} else if (childNode.nodeName !== "tbody" && childNode.childNodes && childNode.childNodes.length > 0) {
					const result = this.findTableWithCells(childNode, requiredClasses);
					if (result) {
						return result;
					}
				}
			}
		}
		return null;
	}

	private hasRequiredClass(node: any, elementName: string, requiredClasses: string[],totalEntry: number): boolean {
		let validEntries = 0;

		for (const childNode of node.childNodes) {
			if (childNode.nodeName === elementName &&
				childNode.childNodes &&
				childNode.childNodes.length > 0
			) {
				Array.from(childNode.childNodes).some((cn: any) => {
					if (cn.nodeName === "td" && cn.attrs && cn.attrs[0].value) {
						if (requiredClasses.includes(cn.attrs[0].value)) {
							validEntries++;
						}
					}
					return false;
				});
				if (validEntries === totalEntry) {
					return true;
				}
			}
		}
		return false;
	}

	private getTableContent(node: any): any[] {
		const tableDocument = [];

		for (const cn of node.childNodes) {
			if (cn.nodeName === "tr") {
				const cleanedChildNodes = cn.childNodes.filter((childNode: any) => {
					// Exclude td elements with class "#text"
					return !(childNode.nodeName === "#text");
				});

				tableDocument.push({
					nodeName: "tr",
					childNodes: cleanedChildNodes
				});
			}
		}

		return tableDocument;
	}

	private async extractValidBuildingHtmls(validBldgTable: any[], rawFile: JSZip): Promise<string[]> {
		const validBuildingHtmls: string[] = [];
		for (const table of validBldgTable) {
			for (const cn of table.childNodes) {
				if (cn.nodeName === "td" &&
					cn.attrs[0].value === "views-field views-field-title") {
					const anchorElement: any = Array.from(cn.childNodes)
						.find((childNode: any) => childNode.nodeName === "a");

					if (anchorElement && anchorElement.attrs && anchorElement.attrs.length > 0) {
						const hrefAttribute = anchorElement.attrs.find((attr: any) => attr.name === "href");
						// todo: Extract the href attribute
						if (hrefAttribute && hrefAttribute.value) {
							// Extract the content between "./campus/discover/buildings-and-classrooms/" and ".htm"
							const match = hrefAttribute
								.value.match(/.*\/(.+?)\.htm/);
							const parts = hrefAttribute.value.split("/");
							// Remove the first element (empty) and the last element (filename)
							parts.shift();
							parts.pop();
							// Join the remaining elements with '/' to get the path
							this.path = parts.join("/");
							if (match && match[1]) {
								const extractedPart = match[1];
								validBuildingHtmls.push(extractedPart);
							}
						}
					}
				}
			}
		}
		return this.isValidBldgHtml(validBuildingHtmls, rawFile);
	}

	private async isValidBldgHtml(html: string[],rawFile: JSZip): Promise<string[]> {
		const directoryPath = this.path;

		try {
			const allFiles = await Promise.all(html.map(async (fileName) => {
				const fileExists = await rawFile.file(`${directoryPath}/${fileName}.htm`) !== null;
				return fileExists ? fileName : null;
			}));

			const validFiles = allFiles.filter((fileName) => fileName !== null) as string[];

			if (validFiles.length > 0) {
				return validFiles;
			} else {
				return Promise.reject("No HTML files");
			}
		} catch (err) {
			return Promise.reject("Error checking file existence");
		}
	}

	private async extractRoomsFromBuildingHtmls(rawFile: JSZip, buildingHtmls: string[]): Promise<any[]> {
		const validRooms: any[] = [];
		const path = this.path + "/";
		const promises = buildingHtmls.map(async (shortName) => {
			const filePath = `${path}${shortName}.htm`; // push b into each room tr
			const fileEntry = rawFile.file(filePath);
			if (fileEntry) {
				const buildingHtmlContent = await fileEntry.async("text");
				const document = parse5.parse(buildingHtmlContent);
				const roomTable = this.findRoomTableWithCells(document, RoomProcessor.RoomFields, shortName);

				if (roomTable) {
					return roomTable;
				} else {
					return null;
				}
			}
		});
		try {
			const results = await Promise.all(promises);
			validRooms.push(...results.flat().filter((room) => room !== null));
			return validRooms;
		} catch (err) {
			return Promise.reject(err);
		}
	}

	private findRoomTableWithCells(node: any, requiredClasses: string[], shortName: string): any | null {
		if (node.childNodes && node.childNodes.length > 0) {
			for (const childNode of node.childNodes) {
				if (childNode.nodeName === "tbody" && this.hasRequiredClass(childNode, "tr", requiredClasses, 4)) {
					return this.validRoomTable = this.getRoomTableContent(childNode, shortName);
				} else if (childNode.nodeName !== "tbody" && childNode.childNodes && childNode.childNodes.length > 0) {
					const result = this.findRoomTableWithCells(childNode, requiredClasses, shortName);
					if (result) {
						return result;
					}
				}
			}
		}
		return null;
	}

	private getRoomTableContent(node: any, shortName: string): any[] {
		const tableDocument = [];

		for (const cn of node.childNodes) {
			if (cn.nodeName === "tr") {
				const cleanedChildNodes = cn.childNodes.filter((childNode: any) => {
					// Exclude td elements with class "#text"
					return !(childNode.nodeName === "#text");
				});
				tableDocument.push({
					nodeName: "tr",
					shortName: shortName,
					childNodes: cleanedChildNodes
				});
			}
		}
		return tableDocument;
	}

	private isValidRoom(room: Rooms): boolean {
		return true;
	}

}
