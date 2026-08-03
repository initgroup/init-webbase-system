-- [ADMIN_USER_LIST]
SELECT USER_ID
     , LOGIN_ID
     , USER_NAME
     , EMAIL
     , ROLE_CODE
     , USE_YN
     , CREATED_AT
     , UPDATED_AT
     , PASSWORD_CHANGE_YN
  FROM (
        SELECT USER_ID
             , LOGIN_ID
             , USER_NAME
             , EMAIL
             , ROLE_CODE
             , USE_YN
             , CREATED_AT
             , UPDATED_AT
             , PASSWORD_CHANGE_YN
          FROM "INIT$_TB_USER"
         WHERE (
               :keyword IS NULL
               OR UPPER(LOGIN_ID) LIKE :keyword
               OR UPPER(USER_NAME) LIKE :keyword
               OR UPPER(EMAIL) LIKE :keyword
              )
           AND (:useYn = 'ALL' OR USE_YN = :useYn)
         ORDER BY CREATED_AT DESC
                , USER_ID DESC
       )
 WHERE ROWNUM <= :limit
;

-- [ADMIN_USER_UPDATE]
UPDATE "INIT$_TB_USER"
   SET LOGIN_ID = :loginId
     , USER_NAME = :userName
     , EMAIL = :email
     , ROLE_CODE = :roleCode
     , USE_YN = :useYn
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_CREATE_DUPLICATE_COUNT]
SELECT COUNT(*)
  FROM "INIT$_TB_USER"
 WHERE LOGIN_ID = :loginId
    OR LOWER(EMAIL) = LOWER(:email)
;

-- [ADMIN_USER_INSERT]
INSERT INTO "INIT$_TB_USER" (
    LOGIN_ID
  , USER_NAME
  , EMAIL
  , PASSWORD_HASH
  , ROLE_CODE
  , USE_YN
  , PASSWORD_CHANGE_YN
  , CREATED_AT
) VALUES (
    :loginId
  , :userName
  , :email
  , :passwordHash
  , :roleCode
  , :useYn
  , 'N'
  , SYSTIMESTAMP
)
;

-- [ADMIN_USER_ID_BY_LOGIN]
SELECT USER_ID
  FROM "INIT$_TB_USER"
 WHERE LOGIN_ID = :loginId
;

-- [ADMIN_USER_DUPLICATE_COUNT]
SELECT COUNT(*)
  FROM "INIT$_TB_USER"
 WHERE USER_ID <> :userId
   AND (
       LOGIN_ID = :loginId
       OR LOWER(EMAIL) = LOWER(:email)
       )
;

-- [ADMIN_USER_TABLE_LOCK]
LOCK TABLE "INIT$_TB_USER" IN EXCLUSIVE MODE
;

-- [ADMIN_USER_ROLE_STATUS]
SELECT ROLE_CODE
     , USE_YN
  FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
;

-- [ADMIN_ACTIVE_ADMIN_COUNT]
SELECT COUNT(*)
  FROM "INIT$_TB_USER"
 WHERE ROLE_CODE = 'ADMIN'
   AND USE_YN = 'Y'
;

-- [ADMIN_USER_PASSWORD_RESET]
UPDATE "INIT$_TB_USER"
   SET PASSWORD_HASH = :passwordHash
     , PASSWORD_CHANGE_YN = 'N'
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_IDENTITY]
SELECT LOGIN_ID
     , USER_NAME
  FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_SESSION_REVOKE]
UPDATE "INIT$_TB_AUTH_SESSION"
   SET REVOKED_AT = LOCALTIMESTAMP
 WHERE USER_ID = :userId
   AND REVOKED_AT IS NULL
;

-- [ADMIN_USER_DELETE]
DELETE FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
;
