export type ReadEffort = "low" | "medium" | "high";

export type ReadBoardRequest = {
  /** base64 JPEG, no data: prefix */
  image: string;
  /** Which color the glasses wearer plays (their pieces are nearest the camera). */
  viewer: "w" | "b";
  effort?: ReadEffort;
};

export type ReadBoardResponse =
  | {
      ok: true;
      visible: boolean;
      /** 8 rows as seen in the image: far side first, each row left to right. */
      rows: string[];
      confidence: "high" | "medium" | "low";
      notes: string;
      model: string;
      ms: number;
    }
  | { ok: false; error: string };
