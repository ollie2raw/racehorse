export interface HowToPlayArticleSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface HowToPlayArticle {
  title: string;
  standfirst: string;
  sections: HowToPlayArticleSection[];
}

export declare const HOW_TO_PLAY_ARTICLE: HowToPlayArticle;
