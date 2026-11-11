/** Built-in example data (all names are invented). */
export interface Example {
  id: string;
  label: string;
  tables: string;
  csv: string;
}

const wedding = `name,party,likes,avoid,never,tags,table
Maya Okafor,couple,,,,bride,Head
Sam Lindqvist,couple,,,,groom,Head
Priya Raman,,Maya Okafor,,,bridal party;uni,Head
Jonas Berg,,Sam Lindqvist,,,bridal party;climbing,Head
Lena Fischer,,Priya Raman,,,bridal party;uni,Head
Tomás Ruiz,,Jonas Berg,,,bridal party;climbing,Head
Grace Okafor,okafor parents,,,Daniel Okafor,bride family,
Peter Okafor,okafor parents,,,,bride family,
Daniel Okafor,,Ada Okafor,,,bride family,
Ada Okafor,okafor-kids,,,,bride family;kids,
Chidi Okafor,okafor-kids,,,,bride family;kids,
Ruth Okafor,,Grace Okafor,,,bride family;elders,
Ingrid Lindqvist,lindqvist parents,,,,groom family,
Erik Lindqvist,lindqvist parents,,Olle Lindqvist,,groom family,
Olle Lindqvist,,Astrid Lindqvist,,,groom family,
Astrid Lindqvist,,,,,groom family;elders,
Freja Lindqvist,freja+noah,,,,groom family,
Noah Clarke,freja+noah,,,,groom family,
Elsa Lindqvist,,Freja Lindqvist,,,groom family;kids,
Nina Petrova,nina+alex,,,,uni,
Alex Moreau,nina+alex,,,,uni,
Hannah Cole,,Priya Raman;Lena Fischer,,,uni,
Omar Haddad,,Hannah Cole,,Rosa Diaz,uni,
Rosa Diaz,,Priya Raman,,,uni;work-maya,
Kenji Watanabe,,,,,uni,
Chloe Martin,chloe+ben,,,,work-maya,
Ben Martin,chloe+ben,,,,,
Aisha Bello,,Chloe Martin,,,work-maya,
Leo Novak,,Aisha Bello,Kenji Watanabe,,work-maya,
Sofia Rossi,,,,,work-maya,
Marta Kowalska,marta+jan,,,,climbing,
Jan Kowalski,marta+jan,Tomás Ruiz,,,climbing,
Ivan Sokolov,,Jonas Berg,,,climbing,
Zoe Turner,,Ivan Sokolov,,,climbing;work-sam,
Felix Wagner,,,,,work-sam,
Mila Horvat,mila+luka,,,,work-sam,
Luka Horvat,mila+luka,,,,,
Ravi Shah,,Felix Wagner,,,work-sam,
Emma Laurent,,Ravi Shah,,,work-sam,
Hugo Laurent,,Emma Laurent,,,,
Clara Jensen,clara+mads,,,,neighbours,
Mads Jensen,clara+mads,,,,neighbours,
Beatrice Hall,,Ruth Okafor;Astrid Lindqvist,,,neighbours;elders,
George Hall,,Beatrice Hall,,,neighbours;elders,
Yara Nasser,,Maya Okafor,,,school-maya,
Imogen Price,,Yara Nasser,Omar Haddad,,school-maya,
Kofi Mensah,,Daniel Okafor,,,school-maya,
Tess Murphy,,Imogen Price,,,school-maya,
Arjun Mehta,,Sam Lindqvist,,,school-sam,
Dylan Brooks,,Arjun Mehta,,,school-sam,
Pia Schmidt,,Dylan Brooks,,,school-sam,
Max Schmidt,,Pia Schmidt,,,school-sam,
`;

const classroom = `name,likes,avoid,never,tags
Ava,Mia;Zara,,,robotics
Ben,Leo,,Kai,football
Cleo,Ava,,,art
Dev,Omar,Ben,,robotics
Ella,Cleo;Ivy,,,art
Finn,Ben,,,football
Gia,Hana,,,choir
Hana,Gia,,Liam,choir
Ivy,Ella,,,art
Jude,Dev,,,robotics
Kai,Finn,,,football
Liam,Kai,,,
Mia,Ava,,,choir
Nora,Pax,,Quinn,
Omar,Dev;Jude,,,robotics
Pax,Nora,,,
Quinn,Ruby,,,art
Ruby,Quinn;Sol,,,
Sol,Ruby,,,choir
Theo,Uma,Finn,,
Uma,Theo,,,
Vik,Wren,,,robotics
Wren,Vik,,,
Xan,Yuki,,Ben,
Yuki,Xan,,,
Zara,Ava,,,choir
Abe,Liam,,,football
Bea,Gia;Hana,,,choir
`;

export const EXAMPLES: Example[] = [
  { id: "wedding", label: "Wedding · 52 guests", tables: "Head:8, 6x8", csv: wedding },
  { id: "classroom", label: "Classroom · 28 students", tables: "7x4", csv: classroom },
];
