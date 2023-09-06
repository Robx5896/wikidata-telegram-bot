import { Entity, Column, DataSource, PrimaryGeneratedColumn, PrimaryColumn } from "typeorm"

@Entity()
export class History {
    @PrimaryGeneratedColumn()
    auto_id!: number

    @Column()
    user_id!: number

    @Column()
    entity!: string

    @Column()
    type!: string

    @Column()
    id!: number
}

@Entity()
export class HistoryPaths {
    @PrimaryColumn()
    user_id!: number

    @Column()
    path!: string
}

@Entity()
export class SparQLQueries {
    @PrimaryColumn()
    user_id!: number

    @Column()
    subject!: string

    @Column()
    predicate!: string

    @Column()
    object!: string

    @Column()
    status!: number
}

const historyDB =  new DataSource({
    type: "sqlite",
    database: "history",
    entities: [ History, HistoryPaths, SparQLQueries ],
    synchronize: true
})

historyDB
    .initialize()
    .then(() => {
        console.log(`Data Source has been initialized`);
    })
    .catch((err: any) => {
        console.error(`Data Source initialization error`, err);
    })

export default historyDB;