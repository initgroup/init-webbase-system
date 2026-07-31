-- [ADMIN_NOTICE_DETAIL]
SELECT N.NOTICE_ID
     , N.NOTICE_TYPE
     , N.TITLE
     , N.CONTENT
     , N.POST_START_AT
     , N.POST_END_AT
     , N.PIN_YN
     , N.USE_YN
     , N.SORT_ORDER
     , N.CREATED_BY
     , N.CREATED_AT
     , N.UPDATED_BY
     , N.UPDATED_AT
     , (
        SELECT COUNT(*)
          FROM "INIT$_TB_NOTICE_FILE" F
         WHERE F.NOTICE_ID = N.NOTICE_ID
           AND F.USE_YN = 'Y'
       ) AS FILE_COUNT
  FROM "INIT$_TB_NOTICE" N
 WHERE N.NOTICE_ID = :noticeId
;

-- [ADMIN_NOTICE_LIST]
SELECT NOTICE_ID
     , NOTICE_TYPE
     , TITLE
     , POST_START_AT
     , POST_END_AT
     , PIN_YN
     , USE_YN
     , SORT_ORDER
     , FILE_COUNT
     , CREATED_AT
     , UPDATED_AT
  FROM (
        SELECT N.NOTICE_ID
             , N.NOTICE_TYPE
             , N.TITLE
             , N.POST_START_AT
             , N.POST_END_AT
             , N.PIN_YN
             , N.USE_YN
             , N.SORT_ORDER
             , (
                SELECT COUNT(*)
                  FROM "INIT$_TB_NOTICE_FILE" F
                 WHERE F.NOTICE_ID = N.NOTICE_ID
                   AND F.USE_YN = 'Y'
               ) AS FILE_COUNT
             , N.CREATED_AT
             , N.UPDATED_AT
          FROM "INIT$_TB_NOTICE" N
         WHERE (
               :keyword IS NULL
               OR UPPER(N.TITLE) LIKE :keyword
               OR INSTR(UPPER(DBMS_LOB.SUBSTR(N.CONTENT, 4000, 1)), :keywordText) > 0
              )
           AND (:useYn = 'ALL' OR N.USE_YN = :useYn)
         ORDER BY N.PIN_YN DESC
                , N.SORT_ORDER
                , N.CREATED_AT DESC
                , N.NOTICE_ID DESC
       )
 WHERE ROWNUM <= :limit
;

-- [ADMIN_NOTICE_INSERT]
INSERT INTO "INIT$_TB_NOTICE" (
    NOTICE_TYPE
  , TITLE
  , CONTENT
  , POST_START_AT
  , POST_END_AT
  , PIN_YN
  , USE_YN
  , SORT_ORDER
  , CREATED_BY
  , CREATED_AT
) VALUES (
    :noticeType
  , :title
  , :content
  , :postStartAt
  , :postEndAt
  , :pinYn
  , :useYn
  , :sortOrder
  , :userId
  , SYSTIMESTAMP
)
RETURNING NOTICE_ID INTO :noticeIdOut
;

-- [ADMIN_NOTICE_UPDATE]
UPDATE "INIT$_TB_NOTICE"
   SET NOTICE_TYPE = :noticeType
     , TITLE = :title
     , CONTENT = :content
     , POST_START_AT = :postStartAt
     , POST_END_AT = :postEndAt
     , PIN_YN = :pinYn
     , USE_YN = :useYn
     , SORT_ORDER = :sortOrder
     , UPDATED_BY = :userId
     , UPDATED_AT = SYSTIMESTAMP
 WHERE NOTICE_ID = :noticeId
;

-- [ADMIN_NOTICE_DELETE]
DELETE
  FROM "INIT$_TB_NOTICE"
 WHERE NOTICE_ID = :noticeId
;

-- [ADMIN_NOTICE_FILE_LIST]
SELECT FILE_ID
     , NOTICE_ID
     , FILE_NAME
     , CONTENT_TYPE
     , FILE_SIZE
     , SORT_ORDER
     , USE_YN
     , CREATED_BY
     , CREATED_AT
  FROM "INIT$_TB_NOTICE_FILE"
 WHERE NOTICE_ID = :noticeId
   AND USE_YN = 'Y'
 ORDER BY SORT_ORDER
        , FILE_ID
;

-- [ADMIN_NOTICE_FILE_INSERT]
INSERT INTO "INIT$_TB_NOTICE_FILE" (
    NOTICE_ID
  , FILE_NAME
  , CONTENT_TYPE
  , FILE_SIZE
  , FILE_DATA
  , SORT_ORDER
  , USE_YN
  , CREATED_BY
  , CREATED_AT
) VALUES (
    :noticeId
  , :fileName
  , :contentType
  , :fileSize
  , :fileData
  , :sortOrder
  , 'Y'
  , :userId
  , SYSTIMESTAMP
)
RETURNING FILE_ID INTO :fileIdOut
;

-- [ADMIN_NOTICE_FILE_DOWNLOAD]
SELECT FILE_ID
     , NOTICE_ID
     , FILE_NAME
     , CONTENT_TYPE
     , FILE_SIZE
     , FILE_DATA
  FROM "INIT$_TB_NOTICE_FILE"
 WHERE FILE_ID = :fileId
   AND USE_YN = 'Y'
;

-- [ADMIN_NOTICE_FILE_DELETE]
DELETE
  FROM "INIT$_TB_NOTICE_FILE"
 WHERE FILE_ID = :fileId
;
